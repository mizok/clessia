// scope-contract: GET /api/class-logs
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493 R7：教務日誌列表看分校範圍**（保留類：授權範圍），對真的本機 PostgREST＋Postgres 跑。
 *
 * 原本管理員路徑只有 org 條件：受限管理員不帶參數就拿到全機構的教務日誌，帶別校 `classId` 也照給。
 * 裁定（11-13）：列表收到範圍內分校的班（`classes!inner` 在 DB 端篩）；指名範圍外的班＝不存在 404；
 * 空範圍 0 列。
 *
 * fixture：C1 的 A 班、C2 的 X 班各一篇日誌。管理員只被指派 C1。
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

run('#2493 教務日誌列表看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '', a: '', x: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one(
      "insert into organizations (name) values ('#2493 契約：教務日誌範圍')",
      [],
    );
    fx.c1 = await one("insert into campuses (org_id, name) values ($1, 'C1')", [ctx.orgId]);
    const c2 = await one("insert into campuses (org_id, name) values ($1, 'C2')", [ctx.orgId]);
    const subject = await one("insert into subjects (org_id, name) values ($1, '英文')", [
      ctx.orgId,
    ]);
    const course = await one(
      "insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, '英文', $3)",
      [ctx.orgId, fx.c1, subject],
    );
    const klass = async (campus: string, name: string) => {
      const id = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, course, name],
      );
      await q(
        `insert into class_logs (org_id, class_id, log_date, teaching_record)
         values ($1, $2, '2026-10-02', $3)`,
        [ctx.orgId, id, `${name} 班的教學紀錄`],
      );
      return id;
    };
    fx.a = await klass(fx.c1, 'A');
    fx.x = await klass(c2, 'X');
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from class_logs where org_id = $1',
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
  const get = async (scope: Scope, query = '') => {
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx.c1] : [];
    try {
      const res = await app.request(`/api/class-logs${query}`, {}, env);
      const body = (await res.json()) as {
        data?: Array<{ classId: string }>;
        meta?: { total: number };
      };
      return { status: res.status, body };
    } finally {
      ctx.campusScope = null;
    }
  };

  it('不帶參數：受限 C1 只看到 A 班；空範圍 0 列；不受限兩班', async () => {
    const c1 = await get('c1');
    expect(c1.body.data!.map((r) => r.classId)).toEqual([fx.a]);
    expect(c1.body.meta!.total).toBe(1);
    expect(JSON.stringify(c1.body)).not.toContain('X 班的教學紀錄');
    expect((await get('none')).body).toEqual({ data: [], meta: { total: 0 } });
    expect((await get('all')).body.data!.map((r) => r.classId).sort()).toEqual([fx.a, fx.x].sort());
  });

  it('指名 classId：受限 C1 指名 X 班 → 404；指名 A 班照常；不受限指名 X 班照常', async () => {
    expect((await get('c1', `?classId=${fx.x}`)).status).toBe(404);
    expect((await get('c1', `?classId=${fx.a}`)).body.data!.map((r) => r.classId)).toEqual([fx.a]);
    expect((await get('all', `?classId=${fx.x}`)).body.data!.map((r) => r.classId)).toEqual([fx.x]);
  });
});
