import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import {
  IDENTITY_SQL,
  loadIdentityViaSql,
  loadMeExtrasViaSql,
  loadNickname,
  type IdentityRows,
} from '../lib/identity-sql';
import { loadIdentity } from '../middleware/auth';

/**
 * Hyperdrive A（#1595）：身分 SQL 對**真的** Postgres 跑，結果要跟 REST 那條（真的 PostgREST）
 * **逐列相同** —— 每一個有登入的 seed 帳號都比。同時這也是 c12 退路的驗證：這裡沒有 Hyperdrive
 * binding，走的是標準的 `DATABASE_URL`（CI 由 `supabase status` 的 `DB_URL` 帶進來）。
 */

const DB = process.env['DATABASE_URL'];
const URL = process.env['SUPABASE_URL'];
const KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if ((!DB || !URL || !KEY) && process.env['CONTRACT_REQUIRED']) {
  // skip 會顯示成綠（#1435 第三跑就是這樣），CI 上拿不到就紅
  throw new Error(
    '[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL／SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY',
  );
}
const run = DB && URL && KEY ? describe : describe.skip;

/** 陣列順序不重要（json_agg 與 REST 都不保證順序），排序後再比 */
function normalize(rows: IdentityRows) {
  const sortDeep = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sortDeep(x)]))
        : v;
  return sortDeep(rows);
}

run('身分 SQL 對真 Postgres（Hyperdrive A）', () => {
  const pool = new Pool({ connectionString: DB });
  const supabase = createClient(URL!, KEY!, { auth: { persistSession: false } });
  afterAll(() => pool.end());

  it('每一個有登入的 seed 帳號：SQL 與 REST 逐列相同', async () => {
    const { rows: users } = await pool.query<{ user_id: string; org_id: string }>(`
      select distinct u.id as user_id, u."orgId"::text as org_id
      from public.ba_user u
      where u."orgId" is not null
        and (exists (select 1 from public.user_roles r where r.user_id = u.id)
          or exists (select 1 from public.staff s where s.user_id = u.id)
          or exists (select 1 from public.parents p where p.user_id = u.id))`);
    expect(users.length).toBeGreaterThan(0); // 沒有任何帳號就什麼都沒比到

    let withCampuses = 0;
    let withChildren = 0;
    for (const { user_id, org_id } of users) {
      const viaSql = await loadIdentityViaSql(pool, user_id, org_id);
      const viaRest = await loadIdentity(supabase, user_id, org_id);
      expect(viaSql, user_id).not.toBeNull();
      expect(normalize(viaSql!), user_id).toEqual(normalize(viaRest!));
      if (viaSql!.staffRows.some((s) => (s as { staff_campuses: unknown[] }).staff_campuses.length))
        withCampuses++;
      if (
        viaSql!.parentRows.some(
          (p) => (p as { parent_student_relations: unknown[] }).parent_student_relations.length,
        )
      )
        withChildren++;
    }
    // 確認比到的資料真的有分校指派與家長關聯，不是一群空陣列在比空陣列
    expect(withCampuses).toBeGreaterThan(0);
    expect(withChildren).toBeGreaterThan(0);
  });

  it('/api/me 的 ba_user＋暱稱：SQL 與 REST 相同', async () => {
    const { rows: users } = await pool.query<{ user_id: string; org_id: string }>(
      `select u.id as user_id, u."orgId"::text as org_id from public.ba_user u where u."orgId" is not null`,
    );
    expect(users.length).toBeGreaterThan(0);
    for (const { user_id, org_id } of users) {
      const viaSql = await loadMeExtrasViaSql(pool, user_id, org_id);
      const [u, nickname] = await Promise.all([
        supabase.from('ba_user').select('name, email, phone').eq('id', user_id).single(),
        // #1665：REST 那條的暱稱規則（沒有 staff 列也是 null，跟 SQL 子查詢一致）
        loadNickname(supabase, user_id, org_id),
      ]);
      expect(viaSql, user_id).toEqual({ baUser: u.data, nickname });
    }
  });

  it('只看本 org：同一個人在別 org 的停用 staff 列、家長列（含關聯學生）都不會被撈進來（交易內建、最後 rollback）', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      // 挑一個本 org 同時有 staff 身分的帳號；家長身分在交易裡另外建，別 org 那筆才有對照
      const { rows } = await client.query<{ user_id: string; org_id: string }>(
        `select s.user_id, s.org_id::text from public.staff s where s.status = 'active' limit 1`,
      );
      const me = rows[0]!;
      const { rows: org } = await client.query<{ id: string }>(
        `insert into public.organizations (name) values ('別的補習班（#1595 contract）') returning id::text`,
      );
      const otherOrg = org[0]!.id;
      await client.query(
        `insert into public.staff (user_id, org_id, display_name, status) values ($1, $2::uuid, '別 org 的同一個人', 'inactive')`,
        [me.user_id, otherOrg],
      );
      // 別 org 的家長列＋一個關聯學生（#1616 reviewer：原本只有 staff，拿掉 parents 的 org 過濾也全綠）
      const { rows: stu } = await client.query<{ id: string }>(
        `insert into public.students (org_id, name, grade) values ($1::uuid, '別 org 的孩子', 'J1') returning id::text`,
        [otherOrg],
      );
      const { rows: par } = await client.query<{ id: string }>(
        `insert into public.parents (user_id, org_id, name) values ($1, $2::uuid, '別 org 的家長身分') returning id::text`,
        [me.user_id, otherOrg],
      );
      await client.query(
        `insert into public.parent_student_relations (parent_id, student_id) values ($1::uuid, $2::uuid)`,
        [par[0]!.id, stu[0]!.id],
      );

      const { rows: result } = await client.query(IDENTITY_SQL, [me.user_id, me.org_id]);
      const { staff, parents } = result[0] as {
        staff: { status: string; display_name: string }[];
        parents: { name: string; parent_student_relations: { student_id: string }[] }[];
      };
      expect(staff.length).toBeGreaterThan(0);
      expect(staff.every((s) => s.status === 'active')).toBe(true);
      expect(staff.some((s) => s.display_name === '別 org 的同一個人')).toBe(false);
      expect(parents.some((p) => p.name === '別 org 的家長身分')).toBe(false);
      const children = parents.flatMap((p) => p.parent_student_relations.map((r) => r.student_id));
      expect(children).not.toContain(stu[0]!.id);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
