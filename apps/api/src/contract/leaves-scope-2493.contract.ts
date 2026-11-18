// scope-contract: POST /api/leaves
// scope-contract: PATCH /api/leaves/:id
// scope-contract: DELETE /api/leaves/:id
// scope-contract: GET /api/leaves/:id/impact
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493：請假的新增、改、刪、影響筆數看分校範圍**（保留類：授權範圍；請假連動出勤、扣堂上游），
 * 對真的本機 PostgREST＋Postgres 跑。GET /leaves 列表的範圍斷言在 leaves-scope.contract.ts。
 *
 * 判準（studentWriteScope）：學生任一報名的班在範圍內才算；學生不在 org → 404；範圍外或空範圍 → 403。
 * 改／刪／影響筆數先找請假單（不存在 404），再以請假單的學生判範圍。
 * fixture：C1、C2；學生 sA（C1）、sX（C2）、sBoth（C1＋C2）；各有一張 2026-06-01 的假。管理員只被指派 C1。
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

run('#2493 請假寫入看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '', sA: '', sX: '', sBoth: '', lA: '', lX: '', lBoth: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：請假範圍')", []);
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
      if (key === 'c1') fx.c1 = campus;
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, `英文 ${key}`, subject],
      );
      klass[key] = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, course, `班 ${key}`],
      );
    }
    const student = (name: string) =>
      one("insert into students (org_id, name, grade) values ($1, $2, 'J2')", [ctx.orgId, name]);
    fx.sA = await student('甲生');
    fx.sX = await student('乙生');
    fx.sBoth = await student('跨校生');
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
    const leave = (studentId: string) =>
      one(
        `insert into leave_requests (org_id, student_id, start_date, end_date, submitted_by, submitted_by_role)
         values ($1, $2, '2026-06-01', '2026-06-01', $3, 'admin')`,
        [ctx.orgId, studentId, ctx.userId],
      );
    fx.lA = await leave(fx.sA);
    fx.lX = await leave(fx.sX);
    fx.lBoth = await leave(fx.sBoth);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from leave_requests where org_id = $1',
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
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx.c1] : [];
    try {
      return await app.request(
        `/api/leaves${path}`,
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
  const create = (scope: Scope, studentId: string, day: string) =>
    call(scope, 'POST', '', { studentId, startDate: day, endDate: day });
  const reason = async (id: string) =>
    (await q<{ reason: string | null }>('select reason from leave_requests where id = $1', [id]))[0]
      ?.reason;
  const exists = async (id: string) =>
    (await q('select 1 from leave_requests where id = $1', [id])).length === 1;
  const countFor = async (studentId: string) =>
    (await q('select 1 from leave_requests where student_id = $1', [studentId])).length;

  it('POST：受限 C1 替 C2 學生請假 → 403 不寫；空範圍 403；C1、跨校學生 201；不受限替 C2 學生 201', async () => {
    expect((await create('c1', fx.sX, '2026-07-01')).status).toBe(403);
    expect(await countFor(fx.sX)).toBe(1);
    expect((await create('none', fx.sA, '2026-07-01')).status).toBe(403);
    expect(await countFor(fx.sA)).toBe(1);
    expect((await create('c1', crypto.randomUUID(), '2026-07-01')).status).toBe(404);
    expect((await create('c1', fx.sA, '2026-07-01')).status).toBe(201);
    expect((await create('c1', fx.sBoth, '2026-07-01')).status).toBe(201);
    expect((await create('all', fx.sX, '2026-07-01')).status).toBe(201);
  });

  it('PATCH /:id：受限 C1 改 C2 學生的假 → 403、不變；空範圍 403；C1 與跨校學生的假 200；不受限改得了 C2', async () => {
    expect((await call('c1', 'PATCH', `/${fx.lX}`, { reason: '偷改' })).status).toBe(403);
    expect(await reason(fx.lX)).toBeNull();
    expect((await call('none', 'PATCH', `/${fx.lA}`, { reason: '偷改' })).status).toBe(403);
    expect(await reason(fx.lA)).toBeNull();
    expect((await call('c1', 'PATCH', `/${crypto.randomUUID()}`, { reason: 'x' })).status).toBe(
      404,
    );
    expect((await call('c1', 'PATCH', `/${fx.lA}`, { reason: '範圍內' })).status).toBe(200);
    expect((await call('c1', 'PATCH', `/${fx.lBoth}`, { reason: '跨校' })).status).toBe(200);
    expect(await reason(fx.lBoth)).toBe('跨校');
    expect((await call('all', 'PATCH', `/${fx.lX}`, { reason: '全校區' })).status).toBe(200);
    expect(await reason(fx.lX)).toBe('全校區');
  });

  it('GET /:id/impact：受限 C1 看 C2 學生的假 → 403；空範圍 403；C1 學生 200；不受限看得到 C2', async () => {
    expect((await call('c1', 'GET', `/${fx.lX}/impact`)).status).toBe(403);
    expect((await call('none', 'GET', `/${fx.lA}/impact`)).status).toBe(403);
    expect((await call('c1', 'GET', `/${fx.lA}/impact`)).status).toBe(200);
    expect((await call('all', 'GET', `/${fx.lX}/impact`)).status).toBe(200);
  });

  it('DELETE /:id：受限 C1 刪 C2 學生的假 → 403 且還在；空範圍 403；C1 學生的假刪得掉；不受限刪得掉 C2', async () => {
    expect((await call('c1', 'DELETE', `/${fx.lX}?mode=full`)).status).toBe(403);
    expect(await exists(fx.lX)).toBe(true);
    expect((await call('none', 'DELETE', `/${fx.lA}?mode=full`)).status).toBe(403);
    expect(await exists(fx.lA)).toBe(true);
    expect((await call('c1', 'DELETE', `/${fx.lA}?mode=full`)).status).toBe(204);
    expect(await exists(fx.lA)).toBe(false);
    expect((await call('all', 'DELETE', `/${fx.lX}?mode=full`)).status).toBe(204);
    expect(await exists(fx.lX)).toBe(false);
  });
});
