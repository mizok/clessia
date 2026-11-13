// scope-contract: GET /api/courses/:id
// scope-contract: PUT /api/courses/:id
// scope-contract: DELETE /api/courses/:id
// scope-contract: GET /api/fee-templates
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493 W2／R1：課程的單筆讀、改、刪看分校範圍；R11：價目表的 inUseCount 只數範圍內報名**
 *（保留類：授權範圍），對真的本機 PostgREST＋Postgres 跑。
 *
 * 原本三支只看 org：受限管理員用 id 讀得到別校課程、停用別校課程（連帶取消它全部班的未來課堂、
 * 通知老師）、刪掉別校沒開班的課程；價目表列表的 inUseCount 數全機構報名（看別校規模的側管道，
 * 同 billing-periods 已修的那種）。裁定（11-13）：範圍外＝404 不寫；inUseCount 收斂到範圍。
 *
 * fixture：C1 有課程 cA（A 班）、C2 有課程 cX（X 班，有一堂未來課）與 cXdel（沒開班）。
 * 價目表 ft：A 班一筆報名、X 班兩筆報名在用。管理員只被指派 C1。
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

run('#2493 課程單筆讀寫與價目表計數看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '', c2: '', cA: '', cX: '', cXdel: '', ft: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：課程範圍')", []);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '理化',
    ]);
    fx.c1 = await one("insert into campuses (org_id, name) values ($1, 'C1')", [ctx.orgId]);
    fx.c2 = await one("insert into campuses (org_id, name) values ($1, 'C2')", [ctx.orgId]);
    const course = (campus: string, name: string) =>
      one('insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)', [
        ctx.orgId,
        campus,
        name,
        subject,
      ]);
    fx.cA = await course(fx.c1, '理化 A');
    fx.cX = await course(fx.c2, '理化 X');
    fx.cXdel = await course(fx.c2, '理化 X 待刪');
    const klass = (campus: string, courseId: string, name: string) =>
      one('insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)', [
        ctx.orgId,
        campus,
        courseId,
        name,
      ]);
    const a = await klass(fx.c1, fx.cA, 'A');
    const x = await klass(fx.c2, fx.cX, 'X');
    fx.ft = await one(
      "insert into fee_templates (org_id, name, billing_mode, amount) values ($1, '月費', 'monthly', 3000)",
      [ctx.orgId],
    );
    for (const classId of [a, x, x]) {
      const student = await one(
        "insert into students (org_id, name, grade) values ($1, '生', 'J2')",
        [ctx.orgId],
      );
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from, fee_template_id)
         values ($1, $2, $3, 'active', 'monthly', 3000, '2026-01-01', $4)`,
        [ctx.orgId, classId, student, fx.ft],
      );
    }
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from enrollments where org_id = $1',
      'delete from fee_templates where org_id = $1',
      'delete from students where org_id = $1',
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
        path,
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
  const course = async (id: string) =>
    (
      await q<{ name: string; is_active: boolean }>(
        'select name, is_active from courses where id = $1',
        [id],
      )
    )[0];

  it('GET /courses/:id：受限 C1 讀 C2 課程 → 404；空範圍連 C1 也讀不到；C1、不受限照常', async () => {
    const out = await call('c1', 'GET', `/api/courses/${fx.cX}`);
    expect(out.status).toBe(404);
    expect(JSON.stringify(await out.json())).not.toContain('理化 X');
    expect((await call('none', 'GET', `/api/courses/${fx.cA}`)).status).toBe(404);
    expect((await call('c1', 'GET', `/api/courses/${fx.cA}`)).status).toBe(200);
    expect((await call('all', 'GET', `/api/courses/${fx.cX}`)).status).toBe(200);
  });

  it('PUT /courses/:id：受限 C1 改名、停用 C2 課程 → 404、都不變；C1 照常', async () => {
    expect((await call('c1', 'PUT', `/api/courses/${fx.cX}`, { name: '偷改' })).status).toBe(404);
    const stop = { isActive: false, deactivateMode: 'cancel_future_sessions' };
    expect((await call('c1', 'PUT', `/api/courses/${fx.cX}`, stop)).status).toBe(404);
    expect(await course(fx.cX)).toEqual({ name: '理化 X', is_active: true });
    expect((await call('c1', 'PUT', `/api/courses/${fx.cA}`, { name: '理化 A1' })).status).toBe(
      200,
    );
    expect((await course(fx.cA))!.name).toBe('理化 A1');
  });

  it('DELETE /courses/:id：受限 C1、空範圍刪 C2 的課程 → 404、還在；不受限照常', async () => {
    expect((await call('c1', 'DELETE', `/api/courses/${fx.cXdel}`)).status).toBe(404);
    expect((await call('none', 'DELETE', `/api/courses/${fx.cXdel}`)).status).toBe(404);
    expect(await course(fx.cXdel)).toBeDefined();
    expect((await call('all', 'DELETE', `/api/courses/${fx.cXdel}`)).status).toBe(200);
    expect(await course(fx.cXdel)).toBeUndefined();
  });

  it('GET /fee-templates：inUseCount 受限 C1 只數 C1 的 1 筆、空範圍 0、不受限 3', async () => {
    const countAs = async (scope: Scope) => {
      const body = (await (await call(scope, 'GET', '/api/fee-templates')).json()) as {
        data: Array<{ id: string; inUseCount: number }>;
      };
      return body.data.find((t) => t.id === fx.ft)!.inUseCount;
    };
    expect(await countAs('c1')).toBe(1);
    expect(await countAs('none')).toBe(0);
    expect(await countAs('all')).toBe(3);
  });
});
