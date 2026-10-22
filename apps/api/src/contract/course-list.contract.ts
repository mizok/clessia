import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **`GET /api/courses` 的兩條路對真 DB 逐欄相同**（#1595 P2，計畫席 10-23 裁定 B）。
 *
 * SQL（`lib/course-list-sql.ts`，Hyperdrive 主路徑）與 query builder（退路）各寫一份條件。
 * 兩份會分岔（#1314 SL3），所以這支把同一組請求各打一次：有 pool → SQL、沒有 pool → builder，
 * 回應要**完全相同**。涵蓋分校範圍（不受限／一間／多間／沒指派）× 指定分校（無／範圍內／範圍外）
 * × 篩選與分頁。
 *
 * **別的 org**：本機 seed 只有一個 org，所以這裡自建一個 org B，故意讓它的列指到 org A 的
 * 科目與課程（FK 不擋跨 org）。SQL 少任何一個 `org_id = $1`，org B 的課、班數或章節就會混進
 * org A 的回應，跟 builder 不同 → 紅。測完刪掉。
 */

const URL = process.env['SUPABASE_URL'];
const KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const DB = process.env['DATABASE_URL'];
if ((!URL || !KEY || !DB) && process.env['CONTRACT_REQUIRED']) {
  throw new Error(
    '[contract] CONTRACT_REQUIRED 但沒有 SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY／DATABASE_URL',
  );
}
const run = URL && KEY && DB ? describe : describe.skip;

const pool = DB ? new Pool({ connectionString: DB }) : null;
afterAll(() => pool?.end());

const ctx: { orgId: string; userId: string; campusScope: string[] | null; usePool: boolean } = {
  orgId: '',
  userId: '',
  campusScope: null,
  usePool: true,
};

vi.mock('../middleware/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../middleware/auth')>();
  const { createMiddleware } = await import('hono/factory');
  return {
    ...original,
    authMiddleware: createMiddleware(async (c, next) => {
      const supabase = createServiceClientFromEnv({
        SUPABASE_URL: URL!,
        SUPABASE_SECRET_KEY: KEY!,
      } as never);
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', supabase);
      set('orgId', ctx.orgId);
      set('userId', ctx.userId);
      set('roles', ['admin']);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', 'admin');
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', ctx.campusScope);
      // builder 模式：pool 的 query 一律失敗 —— 走的是正式的退路（SQL 拋錯 → builder），不是另一條測試專用的路。
      // `end` 是 no-op：authPoolCleanup 每個請求都會呼叫它，而這裡所有請求共用同一個 pool
      set('auth', {
        pool: {
          query: ctx.usePool
            ? pool!.query.bind(pool)
            : async () => {
                throw Object.assign(new Error('contract：強制走 builder'), { code: 'CONTRACT' });
              },
          end: async () => undefined,
        },
      });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

interface CoursesBody {
  data: Array<{ activeClassCount: number }>;
  summary: { bySubject: unknown[] };
}

run('GET /api/courses：SQL 與 builder 對真 DB 逐欄相同（#1595 P2）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  let campuses: string[] = [];
  let firstSubject = '';
  let otherOrg = '';
  const otherIds: string[] = [];
  /** org A 裡為了驗日界線加的班，測完刪掉 */
  const boundaryClasses: string[] = [];

  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];

  beforeAll(async () => {
    const supabase = createClient(URL!, KEY!);
    const { data: roles } = await supabase.from('user_roles').select('user_id').eq('role', 'admin');
    const { data: admin, error } = await supabase
      .from('staff')
      .select('user_id, org_id')
      .in(
        'user_id',
        (roles ?? []).map((r) => r.user_id as string),
      )
      .limit(1)
      .single();
    if (error || !admin) throw new Error(`seed 裡找不到 admin：${error?.message}`);
    ctx.orgId = admin.org_id as string;
    ctx.userId = admin.user_id as string;

    campuses = (
      await q<{ id: string }>('select id from campuses where org_id = $1 order by id', [ctx.orgId])
    ).map((r) => r.id);
    const subjects = await q<{ id: string; name: string }>(
      'select id, name from subjects where org_id = $1 order by sort_order, id',
      [ctx.orgId],
    );
    const courses = await q<{ id: string; name: string }>(
      "select id, name from courses where org_id = $1 and name like '%數學%' order by id limit 1",
      [ctx.orgId],
    );
    expect(campuses.length).toBeGreaterThan(1); // 一間分校的話「範圍外」驗不到
    expect(subjects.length).toBeGreaterThan(1);
    expect(courses.length).toBe(1);
    firstSubject = subjects[0]!.id;

    // org B：同名科目、指到 org A 科目的課（搜「數學」也中）、指到 org A 課程的班
    otherOrg = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#1595 契約：別的 org') returning id",
      )
    )[0]!.id;
    const [campusB] = await q<{ id: string }>(
      "insert into campuses (org_id, name) values ($1, '別 org 分校') returning id",
      [otherOrg],
    );
    const [subjectB] = await q<{ id: string }>(
      'insert into subjects (org_id, name, sort_order) values ($1, $2, -1) returning id',
      [otherOrg, subjects[0]!.name],
    );
    const [courseB] = await q<{ id: string }>(
      'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4) returning id',
      [otherOrg, campusB!.id, courses[0]!.name, firstSubject],
    );
    const [classB] = await q<{ id: string }>(
      "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '別 org 的班') returning id",
      [otherOrg, campusB!.id, courses[0]!.id],
    );
    otherIds.push(campusB!.id, subjectB!.id, courseB!.id, classB!.id);

    // 「已結束」的日界線（end_date < 台北今天）：今天結束的班還算進行中，昨天結束的算已結束。
    // seed 沒有剛好落在今天的班，不加的話 `<` 寫成 `<=` 兩條路一樣綠
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
    const [{ yesterday }] = await q<{ yesterday: string }>(
      "select to_char($1::date - 1, 'YYYY-MM-DD') as yesterday",
      [today],
    );
    for (const [name, end] of [
      ['#1595 契約：今天結束', today],
      ['#1595 契約：昨天結束', yesterday],
    ]) {
      const [row] = await q<{ id: string }>(
        `insert into classes (org_id, campus_id, course_id, name, end_date)
         select org_id, campus_id, id, $2, $3::date from courses where id = $1 returning id`,
        [courses[0]!.id, name, end],
      );
      boundaryClasses.push(row!.id);
    }

    app = (await import('../index')).default as never;
  });

  afterAll(async () => {
    if (boundaryClasses.length)
      await q('delete from classes where id = any($1::uuid[])', [boundaryClasses]);
    if (!otherOrg) return;
    await q('delete from classes where org_id = $1', [otherOrg]);
    await q('delete from courses where org_id = $1', [otherOrg]);
    await q('delete from subjects where org_id = $1', [otherOrg]);
    await q('delete from campuses where org_id = $1', [otherOrg]);
    await q('delete from organizations where id = $1', [otherOrg]);
  });

  const fallbackLogs = (log: { mock: { calls: unknown[][] } }) =>
    log.mock.calls.filter((c) => String(c[0]).includes('[courses-sql]')).length;

  const hit = async (url: string, usePool: boolean) => {
    ctx.usePool = usePool;
    const res = await app.request(url, {}, env);
    return { status: res.status, body: (await res.json()) as CoursesBody };
  };

  it('每種分校範圍 × 指定分校 × 篩選：兩條路回應完全相同，SQL 沒有退回 builder', async () => {
    const log = vi.spyOn(console, 'error');
    const scopes: Record<string, string[] | null> = {
      all: null,
      one: [campuses[0]!],
      many: campuses,
      none: [],
    };
    const requested: Record<string, string | null> = {
      none: null,
      inScope: campuses[0]!,
      outOfScope: campuses[campuses.length - 1]!,
    };
    const filters = [
      '',
      'search=數學',
      'isActive=true',
      'isActive=false',
      `subjectId=${firstSubject}`,
      'pageSize=2&page=2',
      'pageSize=0',
      'page=999',
    ];
    const diffs: string[] = [];
    let compared = 0;
    for (const [sk, scope] of Object.entries(scopes))
      for (const [rk, campus] of Object.entries(requested))
        for (const f of filters) {
          ctx.campusScope = scope;
          const qs = [campus ? `campusId=${campus}` : '', f].filter(Boolean).join('&');
          const url = `/api/courses${qs ? `?${qs}` : ''}`;
          const before = fallbackLogs(log);
          const viaSql = await hit(url, true);
          // SQL 那次不能退回 builder，否則下面的比對就是 builder 對 builder
          if (fallbackLogs(log) !== before) diffs.push(`${sk}|${rk}|${f}：SQL 退回了 builder`);
          const viaBuilder = await hit(url, false);
          compared += 1;
          if (JSON.stringify(viaSql) !== JSON.stringify(viaBuilder)) diffs.push(`${sk}|${rk}|${f}`);
          // 別的 org 的列一筆都不能出現
          const text = JSON.stringify(viaSql);
          if (otherIds.some((id) => text.includes(id))) diffs.push(`${sk}|${rk}|${f}：混進別 org`);
        }
    ctx.campusScope = null;
    expect(compared).toBe(96);
    expect(diffs).toEqual([]);
    // builder 模式真的走了退路（每次 SQL 拋錯都記一行）—— 證明比對的是兩條不同的路
    expect(fallbackLogs(log)).toBeGreaterThan(0);
  });

  it('有資料可比（不是兩邊都空）：不受限時有課、有班數、有章節', async () => {
    const { body } = await hit('/api/courses?pageSize=0', true);
    expect(body.data.length).toBeGreaterThan(10);
    expect(body.data.some((c) => c.activeClassCount > 0)).toBe(true);
    expect(body.summary.bySubject.length).toBeGreaterThan(1);
  });
});
