// scope-contract: GET /api/contact-logs
// scope-contract: POST /api/contact-logs
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493：聯絡紀錄的讀與寫看分校範圍**（保留類：授權範圍；家長聯絡資訊），對真的本機 PostgREST＋Postgres 跑。
 *
 * 授權同 GET /students/:id：學生不在 org 或在範圍外 → 404（跟不存在一樣，不洩漏），空範圍 404。
 * fixture：C1、C2；學生 sA（C1）、sX（C2）、sBoth（C1＋C2）、sNone（沒報名）；每位一筆聯絡紀錄。管理員只被指派 C1。
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

const ctx = { orgId: '', userId: '', c1: '', campusScope: null as string[] | null };

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

run('#2493 聯絡紀錄看分校範圍', () => {
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
    ctx.orgId = await one(
      "insert into organizations (name) values ('#2493 契約：聯絡紀錄範圍')",
      [],
    );
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
      if (key === 'c1') ctx.c1 = campus;
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
    for (const id of [fx.sA, fx.sX, fx.sBoth, fx.sNone])
      await q(
        "insert into contact_logs (org_id, student_id, channel, note, created_by) values ($1, $2, 'phone', '既有', $3)",
        [ctx.orgId, id, ctx.userId],
      );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from contact_logs where org_id = $1',
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
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [ctx.c1] : [];
    try {
      return await app.request(
        `/api/contact-logs${path}`,
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
  const logsOf = async (studentId: string) =>
    (await q('select 1 from contact_logs where student_id = $1', [studentId])).length;

  it('GET：受限 C1 讀得到 C1 與跨校學生；C2、沒報名的 → 404 且不洩漏；空範圍 404；不受限照常', async () => {
    for (const id of [fx.sA, fx.sBoth]) {
      const ok = await call('c1', 'GET', `?studentId=${id}`);
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { data: unknown[] }).data).toHaveLength(1);
    }
    for (const id of [fx.sX, fx.sNone]) {
      const out = await call('c1', 'GET', `?studentId=${id}`);
      expect(out.status).toBe(404);
      expect(JSON.stringify(await out.json())).not.toContain('既有');
    }
    expect((await call('none', 'GET', `?studentId=${fx.sA}`)).status).toBe(404);
    expect((await call('all', 'GET', `?studentId=${fx.sX}`)).status).toBe(200);
  });

  it('POST：受限 C1 替 C2、沒報名的學生記聯絡 → 404 不寫；空範圍 404；C1 與跨校學生 201；不受限記得進 C2', async () => {
    const log = (scope: Scope, studentId: string) =>
      call(scope, 'POST', '', { studentId, channel: 'phone', note: '契約' });
    for (const id of [fx.sX, fx.sNone]) {
      expect((await log('c1', id)).status).toBe(404);
      expect(await logsOf(id)).toBe(1);
    }
    expect((await log('none', fx.sA)).status).toBe(404);
    expect(await logsOf(fx.sA)).toBe(1);
    expect((await log('c1', fx.sA)).status).toBe(201);
    expect((await log('c1', fx.sBoth)).status).toBe(201);
    expect((await log('all', fx.sX)).status).toBe(201);
    expect(await logsOf(fx.sX)).toBe(2);
  });
});
