// scope-contract: GET /api/classes
// scope-contract: GET /api/classes/:id
// scope-contract: GET /api/classes/:id/school-calendar
// scope-contract: GET /api/classes/:id/sessions/preview
// scope-contract: DELETE /api/classes/:id
// scope-contract: DELETE /api/classes/:id/schedules/:sid
// scope-contract: DELETE /api/classes/batch
// scope-contract: PATCH /api/classes/:id/toggle-active
// scope-contract: PATCH /api/classes/batch-set-active
// scope-contract: PATCH /api/classes/:id/sessions/batch-assign-teacher
// scope-contract: PATCH /api/classes/:id/sessions/batch-cancel
// scope-contract: PATCH /api/classes/:id/sessions/batch-uncancel
// scope-contract: PATCH /api/classes/:id/sessions/batch-update-time
// scope-contract: POST /api/classes/:id/cancel-future-sessions
// scope-contract: POST /api/classes/:id/schedules
// scope-contract: POST /api/classes/:id/schedules/:sid/split
// scope-contract: POST /api/classes/:id/sessions/generate
// scope-contract: PUT /api/classes/:id/schedules/:sid
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493 上半：班級 18 支舊端點的分校範圍契約認領**（保留類：授權範圍），對真的本機 PostgREST＋Postgres 跑。
 * 盤點時範圍已 OK，這裡把它釘住。
 *
 * 路徑帶班級 id 的 14 支都走同一支 `classScopeGuard`（`classes.ts`）：範圍外讀 404、寫 403。
 * 每一支各打一次，最後確認 C2 的班、時段、課堂一筆都沒動；同樣的請求在範圍內（C1 打 C1）與不受限
 * （打 C2）都**過得了範圍那一關**（不是 403／404 —— body 故意不帶，停在驗證的 400 或照常 200），
 * 防過度擋。讀取三支另外斷言不受限真的 200。
 * 不帶 id 的三支（列表、批次停用、批次刪除）在路由裡自己比，各自斷言：受限只看到／動到 C1。
 *
 * fixture：C1、C2 各一班、各一個時段；C1 另兩個可刪的空班。管理員只被指派 C1。
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

const ctx = { orgId: '', userId: '', campusScope: null as string[] | null };

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
      set('auth', {
        pool: {
          query: pool!.query.bind(pool),
          connect: pool!.connect.bind(pool),
          end: async () => {},
        },
      });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

run('#2493 班級舊端點看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '', c2: '', class1: '', class2: '', spare1: '', spare2: '' };
  const sched: Record<string, string> = {};

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：班級範圍')", []);
    const subject = await one("insert into subjects (org_id, name) values ($1, '數學')", [
      ctx.orgId,
    ]);
    const klass = (campus: string, course: string, name: string) =>
      one('insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)', [
        ctx.orgId,
        campus,
        course,
        name,
      ]);
    for (const key of ['1', '2'] as const) {
      const campus = await one('insert into campuses (org_id, name) values ($1, $2)', [
        ctx.orgId,
        `C${key}`,
      ]);
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, `數學 C${key}`, subject],
      );
      fx[`c${key}`] = campus;
      fx[`class${key}`] = await klass(campus, course, `班 C${key}`);
      if (key === '1') {
        fx.spare1 = await klass(campus, course, '可刪的班甲');
        fx.spare2 = await klass(campus, course, '可刪的班乙');
      }
    }
    for (const id of [fx.class1, fx.class2]) {
      sched[id] = await one(
        `insert into schedules (class_id, weekday, start_time, end_time, effective_from)
         values ($1, 1, '18:00', '19:00', '2026-01-01')`,
        [id],
      );
    }
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from sessions where class_id in (select id from classes where org_id = $1)',
      'delete from schedules where class_id in (select id from classes where org_id = $1)',
      'delete from classes where org_id = $1',
      'delete from courses where org_id = $1',
      'delete from subjects where org_id = $1',
      'delete from campuses where org_id = $1',
      'delete from audit_logs where org_id = $1',
      'delete from organizations where id = $1',
    ]) {
      await q(sql, [ctx.orgId]);
    }
  }, 120_000);

  type Scope = 'all' | 'c1' | 'none';
  const call = async (scope: Scope, method: string, path: string, body?: unknown) => {
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx.c1] : [];
    try {
      return await app.request(
        `/api/classes${path}`,
        {
          method,
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        env,
      );
    } finally {
      ctx.campusScope = null;
    }
  };
  const snapshot = async () =>
    JSON.stringify(
      await q(
        `select c.name, c.is_active,
                (select count(*)::int from schedules s where s.class_id = c.id) schedules,
                (select count(*)::int from sessions s where s.class_id = c.id) sessions
           from classes c where c.id = $1`,
        [fx.class2],
      ),
    );

  const RANGE = '?from=2026-01-01&to=2026-01-31';
  /** 帶班級 id 的 14 支：[方法, id 之後的路徑]；`:sid` 換成那個班自己的時段 */
  const BY_ID: Array<[string, string]> = [
    ['GET', ''],
    ['GET', `/school-calendar${RANGE}`],
    ['GET', `/sessions/preview${RANGE}`],
    ['DELETE', ''],
    ['PATCH', '/toggle-active'],
    ['PATCH', '/sessions/batch-assign-teacher'],
    ['PATCH', '/sessions/batch-cancel'],
    ['PATCH', '/sessions/batch-uncancel'],
    ['PATCH', '/sessions/batch-update-time'],
    ['POST', '/cancel-future-sessions'],
    ['POST', '/schedules'],
    ['POST', '/schedules/:sid/split'],
    ['POST', '/sessions/generate'],
    ['PUT', '/schedules/:sid'],
    // 放最後：防過度擋那條會真的刪掉時段
    ['DELETE', '/schedules/:sid'],
  ];
  const byId = (id: string, rest: string) => `/${id}${rest.replace(':sid', sched[id]!)}`;
  // 寫入一律帶空 body：範圍那一關在驗證之前（app.use），範圍內就停在驗證的 400。
  // PUT 時段例外：欄位全 optional，空 body 驗證會過、更新空集合回 404「時段不存在」，給它一個真的欄位
  const bodyOf = (method: string, rest = '') =>
    method === 'GET' || method === 'DELETE'
      ? undefined
      : method === 'PUT' && rest === '/schedules/:sid'
        ? { endTime: '19:30' }
        : {};

  it('帶 id 的 14 支：受限 C1 打 C2 → 讀 404、寫 403；空範圍同；C2 的班一筆都沒動', async () => {
    const before = await snapshot();
    for (const scope of ['c1', 'none'] as const) {
      for (const [method, rest] of BY_ID) {
        const res = await call(scope, method, byId(fx.class2, rest), bodyOf(method));
        expect(`${scope} ${method} ${rest} → ${res.status}`).toBe(
          `${scope} ${method} ${rest} → ${method === 'GET' ? 404 : 403}`,
        );
      }
    }
    expect(await snapshot()).toBe(before);
  });

  it('帶 id 的 14 支：C1 打 C1、不受限打 C2 都過得了範圍那一關（防過度擋）', async () => {
    // 讀取三支先斷言真的 200（迴圈裡的「停用」會把 C2 班關掉，之後 preview 回 409）
    expect((await call('all', 'GET', `/${fx.class2}`)).status).toBe(200);
    expect((await call('all', 'GET', `/${fx.class2}/school-calendar${RANGE}`)).status).toBe(200);
    expect((await call('all', 'GET', `/${fx.class2}/sessions/preview${RANGE}`)).status).toBe(200);
    // DELETE /:id 不在這裡打（會真的刪班）；放到下一條用可刪的空班
    for (const [method, rest] of BY_ID.filter(([m, r]) => !(m === 'DELETE' && r === ''))) {
      for (const [scope, id] of [
        ['c1', fx.class1],
        ['all', fx.class2],
      ] as const) {
        const res = await call(scope, method, byId(id, rest), bodyOf(method, rest));
        expect(`${scope} ${method} ${rest} → ${res.status}`).not.toMatch(/→ 40[34]$/);
      }
    }
  });

  it('DELETE /:id：受限 C1 刪得掉自己的空班；不受限 200', async () => {
    expect((await call('c1', 'DELETE', `/${fx.spare1}`)).status).toBe(200);
    const [n] = await q<{ n: number }>('select count(*)::int n from classes where id = $1', [
      fx.spare1,
    ]);
    expect(n!.n).toBe(0);
  });

  it('GET /：受限 C1 只列 C1 的班；空範圍 0 列；不受限兩校都在', async () => {
    const names = async (scope: Scope) =>
      (
        (await (await call(scope, 'GET', '?pageSize=100')).json()) as { data: { name: string }[] }
      ).data
        .map((r) => r.name)
        .filter((n) => n.startsWith('班 '))
        .sort();
    expect(await names('c1')).toEqual(['班 C1']);
    expect(await names('none')).toEqual([]);
    expect(await names('all')).toEqual(['班 C1', '班 C2']);
  });

  it('PATCH /batch-set-active、DELETE /batch：受限 C1 帶到 C2 的班 → 整批擋、C2 沒動；不受限照常', async () => {
    const before = await snapshot();
    const denied = await call('c1', 'PATCH', '/batch-set-active', {
      ids: [fx.class1, fx.class2],
      isActive: false,
    });
    expect(denied.status).toBe(403);
    const gone = await call('c1', 'DELETE', '/batch', { ids: [fx.spare2, fx.class2] });
    expect(gone.status).toBe(404);
    expect(await snapshot()).toBe(before);
    const [left] = await q<{ n: number }>('select count(*)::int n from classes where id = $1', [
      fx.spare2,
    ]);
    expect(left!.n).toBe(1);

    expect(
      (await call('all', 'PATCH', '/batch-set-active', { ids: [fx.class2], isActive: true }))
        .status,
    ).toBe(200);
    const ok = await call('all', 'DELETE', '/batch', { ids: [fx.spare2] });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ deleted: 1 });
  });
});
