// scope-contract: GET /api/sessions/:id/changes
// scope-contract: GET /api/sessions/substituted-away
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493 R4：單堂異動紀錄與「被代課」清單看分校範圍**（保留類：授權範圍），對真的本機 PostgREST＋Postgres 跑。
 *
 * 原本兩支只看 org：受限管理員用 id 讀得到別校課堂的建立者與完整異動、帶任一老師 id 看得到他在別校被代的課。
 * 裁定（11-13）：範圍外跟不存在一樣——`/:id/changes` 對不存在本來就回 200 空陣列，範圍外同一個回應；
 * substituted-away 只回範圍內分校的課堂；空範圍 0 列。
 *
 * fixture：C1 的 A 班、C2 的 X 班各一堂課（sA、sX），同一位老師 t 兩堂都被代課。管理員只被指派 C1。
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

run('#2493 課務異動單筆與被代課清單看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '', sA: '', sX: '', t: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：異動範圍')", []);
    fx.c1 = await one("insert into campuses (org_id, name) values ($1, 'C1')", [ctx.orgId]);
    const c2 = await one("insert into campuses (org_id, name) values ($1, 'C2')", [ctx.orgId]);
    const subject = await one("insert into subjects (org_id, name) values ($1, '數學')", [
      ctx.orgId,
    ]);
    const course = await one(
      "insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, '數學', $3)",
      [ctx.orgId, fx.c1, subject],
    );
    fx.t = await one(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '原老師')",
      [ctx.orgId, ctx.userId],
    );
    const session = async (campus: string, name: string) => {
      const klass = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, course, name],
      );
      const id = await one(
        `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
         values ($1, $2, '2026-10-02', '18:00', '19:00', 'scheduled', 'unassigned')`,
        [ctx.orgId, klass],
      );
      await q(
        `insert into schedule_changes (org_id, session_id, change_type, created_by_name, reason, original_teacher_id)
         values ($1, $2, 'substitute', '行政', '請假', $3)`,
        [ctx.orgId, id, fx.t],
      );
      return id;
    };
    fx.sA = await session(fx.c1, 'A');
    fx.sX = await session(c2, 'X');
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from schedule_changes where org_id = $1',
      'delete from sessions where org_id = $1',
      'delete from classes where org_id = $1',
      'delete from staff where org_id = $1',
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
  const get = async (scope: Scope, path: string) => {
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx.c1] : [];
    try {
      const res = await app.request(`/api/sessions${path}`, {}, env);
      return {
        status: res.status,
        body: (await res.json()) as { data: Array<Record<string, unknown>> },
      };
    } finally {
      ctx.campusScope = null;
    }
  };

  it('GET /:id/changes：受限 C1 讀 C2 課堂 → 跟不存在一樣（200 空）；空範圍也空；C1、不受限照常', async () => {
    expect(await get('c1', `/${fx.sX}/changes`)).toEqual({ status: 200, body: { data: [] } });
    expect((await get('none', `/${fx.sA}/changes`)).body.data).toEqual([]);
    expect((await get('c1', `/${fx.sA}/changes`)).body.data.length).toBeGreaterThan(0);
    expect((await get('all', `/${fx.sX}/changes`)).body.data.length).toBeGreaterThan(0);
  });

  it('GET /substituted-away：受限 C1 只看到 C1 那堂；空範圍 0 列；不受限兩堂', async () => {
    const path = `/substituted-away?teacherId=${fx.t}&from=2026-10-01&to=2026-10-31`;
    const ids = async (scope: Scope) =>
      (await get(scope, path)).body.data.map((r) => r['sessionId']).sort();
    expect(await ids('c1')).toEqual([fx.sA]);
    expect(await ids('none')).toEqual([]);
    expect(await ids('all')).toEqual([fx.sA, fx.sX].sort());
  });
});
