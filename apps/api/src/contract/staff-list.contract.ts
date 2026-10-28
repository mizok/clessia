import { writeFileSync, readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **`GET /api/staff` 的兩條路對真 DB 逐欄相同**（#1595 P2 第二刀，模式同 `course-list.contract.ts`）。
 *
 * SQL（`lib/staff-list-sql.ts`，Hyperdrive 主路徑）與 query builder（退路）各寫一份條件，所以把同一組請求
 * 各打一次：有 pool → SQL、pool 拋錯 → builder，回應要**完全相同**。涵蓋分校範圍（不受限／一間／多間／
 * 沒指派）× 指定分校（無／範圍內／範圍外）× 篩選（角色、科目、搜尋、狀態）與分頁。
 *
 * **別的 org**：自建 org B，它的人員指到 org A 的使用者、分校、科目（FK 不擋跨 org）。SQL 少任何一個
 * `org_id = $1`，org B 的人就會混進 org A 的回應 → 紅。測完刪掉。
 *
 * **改前基準**（計畫席：錄改前回應當基準）：`STAFF_BASELINE_WRITE=<檔>` 時把 builder 的回應寫出去
 * （在改之前的 main 上跑），`STAFF_BASELINE_READ=<檔>` 時拿現在兩條路跟它比。改前 builder 的列序與陣列序
 * 不固定（seed 的人員 `created_at` 全部相同），所以基準比對先正規化排序；兩條路之間則逐字相同。
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
      // builder 模式：pool 的 query 一律失敗 —— 走的是正式的退路（SQL 拋錯 → builder）
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

type Body = {
  data: Array<Record<string, unknown> & { id: string }>;
  summary: Record<string, unknown>;
  meta: Record<string, unknown>;
};

/** 基準比對用：改前 builder 的列序與陣列序不固定 */
const normalize = (b: { status: number; body: Body }) => ({
  status: b.status,
  summary: b.body.summary,
  meta: b.body.meta,
  data: [...(b.body.data ?? [])]
    .map((s) =>
      Object.fromEntries(
        Object.entries(s).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]),
      ),
    )
    .sort((x, y) => String(x['id']).localeCompare(String(y['id']))),
});

run('GET /api/staff：SQL 與 builder 對真 DB 逐欄相同（#1595 P2）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  let campuses: string[] = [];
  let subject = '';
  let otherOrg = '';
  let otherStaff = '';
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];

  beforeAll(async () => {
    const [org] = await q<{ id: string }>("select id from organizations where slug = 'demo'");
    ctx.orgId = org!.id;
    const [admin] = await q<{ user_id: string }>(
      `select s.user_id from staff s join user_roles r on r.user_id = s.user_id and r.role = 'admin'
        where s.org_id = $1 order by s.user_id limit 1`,
      [ctx.orgId],
    );
    ctx.userId = admin!.user_id;
    campuses = (
      await q<{ id: string }>('select id from campuses where org_id = $1 order by id', [ctx.orgId])
    ).map((r) => r.id);
    [{ id: subject }] = (await q<{ id: string }>(
      `select ss.subject_id as id from staff_subjects ss join staff s on s.id = ss.staff_id
        where s.org_id = $1 group by ss.subject_id order by count(*) desc limit 1`,
      [ctx.orgId],
    )) as [{ id: string }];
    // org B：人員指到 org A 的使用者、分校、科目
    [{ id: otherOrg }] = (await q<{ id: string }>(
      "insert into organizations (name) values ('#1595 契約：人員列表別 org') returning id",
    )) as [{ id: string }];
    [{ id: otherStaff }] = (await q<{ id: string }>(
      `insert into staff (org_id, user_id, display_name) values ($1, $2, '別 org 的老師') returning id`,
      [otherOrg, ctx.userId],
    )) as [{ id: string }];
    await q('insert into staff_campuses (staff_id, campus_id) values ($1, $2)', [
      otherStaff,
      campuses[0],
    ]);
    await q('insert into staff_subjects (staff_id, subject_id) values ($1, $2)', [
      otherStaff,
      subject,
    ]);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!otherOrg) return;
    await q('delete from staff_campuses where staff_id = $1', [otherStaff]);
    await q('delete from staff_subjects where staff_id = $1', [otherStaff]);
    await q('delete from staff where org_id = $1', [otherOrg]);
    await q('delete from organizations where id = $1', [otherOrg]);
  });

  const fallbackLogs = (log: { mock: { calls: unknown[][] } }) =>
    log.mock.calls.filter((c) => String(c[0]).includes('[staff-sql]')).length;
  const hit = async (url: string, usePool: boolean) => {
    ctx.usePool = usePool;
    const res = await app.request(url, {}, env);
    return { status: res.status, body: (await res.json()) as Body };
  };

  const matrix = () => {
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
      'role=admin',
      'role=teacher',
      'role=kiosk',
      `subjectId=${subject}`,
      'search=老師',
      'search=example',
      'search=09',
      'status=active',
      'status=archived',
      'pageSize=5&page=2',
      'pageSize=0',
      'page=999',
    ];
    const out: Array<{ key: string; url: string; scope: string[] | null }> = [];
    for (const [sk, scope] of Object.entries(scopes))
      for (const [rk, campus] of Object.entries(requested))
        for (const f of filters) {
          const qs = [campus ? `campusId=${campus}` : '', f].filter(Boolean).join('&');
          out.push({ key: `${sk}|${rk}|${f}`, url: `/api/staff${qs ? `?${qs}` : ''}`, scope });
        }
    return out;
  };

  it('每種分校範圍 × 指定分校 × 篩選：兩條路回應完全相同，SQL 沒有退回 builder，別 org 不混入', async () => {
    const log = vi.spyOn(console, 'error');
    const diffs: string[] = [];
    /** builder 本來就壞的題（改前基準也是 500）：SQL 回 200，另外用獨立 SQL 驗它 */
    const builderBroken: string[] = [];
    const cases = matrix();
    const baselineOut: Record<string, unknown> = {};
    const baselineIn = process.env['STAFF_BASELINE_READ']
      ? (JSON.parse(readFileSync(process.env['STAFF_BASELINE_READ'], 'utf8')) as Record<
          string,
          unknown
        >)
      : null;
    for (const c of cases) {
      ctx.campusScope = c.scope;
      const viaBuilder = await hit(c.url, false);
      if (process.env['STAFF_BASELINE_WRITE']) {
        baselineOut[c.key] = normalize(viaBuilder);
        continue;
      }
      const before = fallbackLogs(log);
      const viaSql = await hit(c.url, true);
      if (fallbackLogs(log) !== before) diffs.push(`${c.key}：SQL 退回了 builder`);
      if (viaBuilder.status >= 500 && viaSql.status === 200) {
        builderBroken.push(c.key);
        continue;
      }
      if (JSON.stringify(viaSql) !== JSON.stringify(viaBuilder)) diffs.push(c.key);
      if (JSON.stringify(viaSql).includes(otherStaff)) diffs.push(`${c.key}：混進別 org`);
      if (baselineIn) {
        // 改前同分沒有末鍵：結果超過一頁時拿到哪幾位本來就不固定 —— 那種情況只比摘要與 meta
        const now = normalize(viaSql);
        const was = baselineIn[c.key] as ReturnType<typeof normalize>;
        const whole = viaSql.body.meta?.['total'] === viaSql.body.data?.length;
        const same = whole
          ? JSON.stringify(now) === JSON.stringify(was)
          : JSON.stringify([now.status, now.summary, now.meta]) ===
            JSON.stringify([was.status, was.summary, was.meta]);
        if (!same) diffs.push(`${c.key}：跟改前基準不同`);
      }
    }
    ctx.campusScope = null;
    if (process.env['STAFF_BASELINE_WRITE']) {
      writeFileSync(process.env['STAFF_BASELINE_WRITE'], JSON.stringify(baselineOut));
      return;
    }
    expect(cases).toHaveLength(156);
    expect(diffs).toEqual([]);
    // 多分校範圍＋角色篩選：章節 head count 要同時帶 ~88 個 staff id 與兩份 ~87 個 user id，URL 超過上限，
    // PostgREST 回 414、supabase-js 給空訊息 → 500（#1928 同一類）。改前就是這樣；SQL 這條沒有 URL。
    // 依 seed 而定 —— seed 改了這張清單跟著改，差異本身就是有用的訊號
    expect(builderBroken).toEqual(['many|none|role=teacher']);
    expect(fallbackLogs(log)).toBeGreaterThan(0); // builder 模式真的走了退路
  });

  it('builder 撞 URL 上限的那題：SQL 的總數與章節等於直接數 DB', async () => {
    ctx.campusScope = campuses;
    const { status, body } = await hit('/api/staff?role=teacher', true);
    ctx.campusScope = null;
    const [n] = await q<{ total: number; active: number }>(
      `select count(*)::int total, count(*) filter (where s.status = 'active'
                and not exists (select 1 from user_roles a where a.user_id = s.user_id and a.role = 'admin'))::int active
         from staff s
        where s.org_id = $1
          and s.user_id in (select user_id from user_roles where role = 'teacher')
          and s.id in (select sc.staff_id from staff_campuses sc where sc.campus_id = any($2::uuid[]))`,
      [ctx.orgId, campuses],
    );
    expect(status).toBe(200);
    expect(body.meta['total']).toBe(n!.total);
    expect((body.summary['byRole'] as Record<string, number>)['teacher']).toBe(n!.active);
  });

  it('有資料可比（不是兩邊都空）：不受限時有人、有分校、有科目、章節分得開', async () => {
    const { body } = await hit('/api/staff?pageSize=0', true);
    expect(body.data.length).toBeGreaterThan(10);
    expect(body.data.some((s) => (s['campusIds'] as unknown[]).length > 0)).toBe(true);
    expect(body.data.some((s) => (s['subjectNames'] as unknown[]).length > 0)).toBe(true);
    const byRole = body.summary['byRole'] as Record<string, number>;
    expect(byRole['admin']).toBeGreaterThan(0);
    expect(byRole['teacher']).toBeGreaterThan(0);
  });
});
