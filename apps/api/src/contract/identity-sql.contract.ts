import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import {
  IDENTITY_SQL,
  loadIdentityViaSql,
  loadMeExtrasViaSql,
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

  it('/api/me 的 profiles＋ba_user：SQL 與 REST 相同', async () => {
    const { rows: users } = await pool.query<{ user_id: string; org_id: string }>(
      `select u.id as user_id, u."orgId"::text as org_id from public.ba_user u where u."orgId" is not null`,
    );
    expect(users.length).toBeGreaterThan(0);
    for (const { user_id, org_id } of users) {
      const viaSql = await loadMeExtrasViaSql(pool, user_id, org_id);
      const [p, u] = await Promise.all([
        supabase.from('profiles').select('display_name').eq('id', user_id).maybeSingle(),
        supabase.from('ba_user').select('name, email, phone').eq('id', user_id).single(),
      ]);
      expect(viaSql, user_id).toEqual({ profile: p.data, baUser: u.data });
    }
  });

  it('只看本 org：同一個人在別 org 的停用 staff 列不會被撈進來（交易內建、最後 rollback）', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query<{ user_id: string; org_id: string }>(
        `select s.user_id, s.org_id::text from public.staff s where s.status = 'active' limit 1`,
      );
      const me = rows[0]!;
      const { rows: org } = await client.query<{ id: string }>(
        `insert into public.organizations (name) values ('別的補習班（#1595 contract）') returning id::text`,
      );
      await client.query(
        `insert into public.staff (user_id, org_id, display_name, status) values ($1, $2::uuid, '別 org 的同一個人', 'inactive')`,
        [me.user_id, org[0]!.id],
      );

      const { rows: result } = await client.query(IDENTITY_SQL, [me.user_id, me.org_id]);
      const staff = (result[0] as { staff: { status: string }[] }).staff;
      expect(staff.length).toBeGreaterThan(0);
      expect(staff.every((s) => s.status === 'active')).toBe(true);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
