// scope-contract: GET /api/students/:id
// scope-contract: PUT /api/students/:id
// scope-contract: DELETE /api/students/:id
// scope-contract: GET /api/students/:id/attendance-days
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493：學生單筆讀、改、刪、到班格看分校範圍**（保留類：授權範圍），對真的本機 PostgREST＋Postgres 跑。
 *
 * 判準（#1394）：學生任一報名（不分狀態）的班在範圍內才算範圍內；沒有任何報名的學生推不出分校，
 * 對受限者是範圍外。範圍外＝404、不改、不刪。
 * （GET /students 列表的範圍斷言在 students-scope-1928.contract.ts）
 *
 * fixture：C1、C2；學生 sA（只在 C1）、sX（只在 C2）、sBoth（C1＋C2）、sNone（沒有報名）。管理員只被指派 C1。
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

run('#2493 學生單筆讀寫看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { sA: '', sX: '', sBoth: '', sNone: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：學生範圍')", []);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '英文',
    ]);
    const klass: Record<string, string> = {};
    for (const key of ['c1', 'c2']) {
      const campus = await one('insert into campuses (org_id, name) values ($1, $2)', [
        ctx.orgId,
        key,
      ]);
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, `英文 ${key}`, subject],
      );
      klass[key] = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, course, `班 ${key}`],
      );
      if (key === 'c1') (ctx as Record<string, unknown>)['c1'] = campus;
    }
    const student = (name: string) =>
      one("insert into students (org_id, name, grade) values ($1, $2, 'J2')", [ctx.orgId, name]);
    fx.sA = await student('甲生');
    fx.sX = await student('乙生');
    fx.sBoth = await student('跨校生');
    fx.sNone = await student('沒報名');
    const enroll = (studentId: string, classId: string) =>
      q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
        [ctx.orgId, classId, studentId],
      );
    await enroll(fx.sA, klass['c1']!);
    await enroll(fx.sX, klass['c2']!);
    await enroll(fx.sBoth, klass['c1']!);
    await enroll(fx.sBoth, klass['c2']!);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from enrollments where org_id = $1',
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
    const c1 = (ctx as unknown as { c1: string }).c1;
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [c1] : [];
    try {
      return await app.request(
        `/api/students${path}`,
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
  const notes = async (id: string) =>
    (await q<{ notes: string | null }>('select notes from students where id = $1', [id]))[0]?.notes;
  const exists = async (id: string) =>
    (await q('select 1 from students where id = $1', [id])).length === 1;

  it('GET /:id：受限 C1 讀得到 C1 與跨校學生；C2、沒報名的 → 404 且不洩漏姓名；空範圍 404；不受限照常', async () => {
    expect((await call('c1', 'GET', `/${fx.sA}`)).status).toBe(200);
    expect((await call('c1', 'GET', `/${fx.sBoth}`)).status).toBe(200);
    const out = await call('c1', 'GET', `/${fx.sX}`);
    expect(out.status).toBe(404);
    expect(JSON.stringify(await out.json())).not.toContain('乙生');
    expect((await call('c1', 'GET', `/${fx.sNone}`)).status).toBe(404);
    expect((await call('none', 'GET', `/${fx.sA}`)).status).toBe(404);
    expect((await call('all', 'GET', `/${fx.sX}`)).status).toBe(200);
    expect((await call('all', 'GET', `/${fx.sNone}`)).status).toBe(200);
  });

  it('PUT /:id：受限 C1 改 C2、沒報名的學生 → 404、不變；空範圍 404；C1 學生照常；不受限改得了 C2', async () => {
    for (const id of [fx.sX, fx.sNone]) {
      expect((await call('c1', 'PUT', `/${id}`, { notes: '偷改' })).status).toBe(404);
      expect(await notes(id)).toBeNull();
    }
    expect((await call('none', 'PUT', `/${fx.sA}`, { notes: '偷改' })).status).toBe(404);
    expect(await notes(fx.sA)).toBeNull();
    expect((await call('c1', 'PUT', `/${fx.sA}`, { notes: '範圍內' })).status).toBe(200);
    expect(await notes(fx.sA)).toBe('範圍內');
    expect((await call('all', 'PUT', `/${fx.sX}`, { notes: '全校區' })).status).toBe(200);
    expect(await notes(fx.sX)).toBe('全校區');
  });

  it('DELETE /:id：受限 C1 對 C2、沒報名的 → 404 且沒被刪；C1 學生有報名 → 409；不受限刪得掉沒報名的', async () => {
    for (const id of [fx.sX, fx.sNone]) {
      expect((await call('c1', 'DELETE', `/${id}`)).status).toBe(404);
      expect(await exists(id)).toBe(true);
    }
    expect((await call('none', 'DELETE', `/${fx.sA}`)).status).toBe(404);
    expect((await call('c1', 'DELETE', `/${fx.sA}`)).status).toBe(409);
    expect(await exists(fx.sA)).toBe(true);
    expect((await call('all', 'DELETE', `/${fx.sNone}`)).status).toBe(200);
    expect(await exists(fx.sNone)).toBe(false);
  });

  it('GET /:id/attendance-days：受限 C1 對 C2、跨校外的學生 → 404；C1 與跨校學生 200；空範圍 404；不受限照常', async () => {
    const qs = '?from=2026-11-01&to=2026-11-07';
    expect((await call('c1', 'GET', `/${fx.sX}/attendance-days${qs}`)).status).toBe(404);
    expect((await call('none', 'GET', `/${fx.sA}/attendance-days${qs}`)).status).toBe(404);
    expect((await call('c1', 'GET', `/${fx.sA}/attendance-days${qs}`)).status).toBe(200);
    expect((await call('c1', 'GET', `/${fx.sBoth}/attendance-days${qs}`)).status).toBe(200);
    expect((await call('all', 'GET', `/${fx.sX}/attendance-days${qs}`)).status).toBe(200);
  });
});
