// scope-contract: POST /api/daily-checkins
// scope-contract: DELETE /api/daily-checkins/:id
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493：到班打卡的新增與刪除看分校範圍**（保留類：授權範圍；連動出勤），對真的本機 PostgREST＋Postgres 跑。
 *
 * POST：body 的 campusId 全域守衛看不到，路由自己驗（範圍外 403）；打卡分校填自己的、學生卻是別校的也 403；
 * 學生不存在 404。DELETE：打卡有記分校就看它，沒記退回學生的分校；範圍外 403、紀錄還在。
 * fixture：C1、C2；學生 sA（C1）、sX（C2）；sX 已有一筆 C2 打卡（記分校）與一筆沒記分校的打卡（舊資料）。管理員只被指派 C1。
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

const ctx = { orgId: '', userId: '', c1: '', c2: '', campusScope: null as string[] | null };

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

run('#2493 到班打卡看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { sA: '', sX: '', dCampus: '', dLegacy: '' };
  const day = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one(
      "insert into organizations (name) values ('#2493 契約：到班打卡範圍')",
      [],
    );
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '英文',
    ]);
    const klass: Record<string, string> = {};
    for (const key of ['c1', 'c2'] as const) {
      const campus = await one('insert into campuses (org_id, name) values ($1, $2)', [
        ctx.orgId,
        key,
      ]);
      ctx[key] = campus;
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, `英文 ${key}`, subject],
      );
      klass[key] = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, course, `班 ${key}`],
      );
    }
    for (const [key, name, cls] of [
      ['sA', '甲生', 'c1'],
      ['sX', '乙生', 'c2'],
    ] as const) {
      fx[key] = await one("insert into students (org_id, name, grade) values ($1, $2, 'J2')", [
        ctx.orgId,
        name,
      ]);
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
        [ctx.orgId, klass[cls], fx[key]],
      );
    }
    fx.dCampus = await one(
      'insert into daily_checkins (org_id, student_id, checkin_date, campus_id) values ($1, $2, $3, $4)',
      [ctx.orgId, fx.sX, day, ctx.c2],
    );
    fx.dLegacy = await one(
      'insert into daily_checkins (org_id, student_id, checkin_date) values ($1, $2, $3)',
      [ctx.orgId, fx.sX, addDay(day)],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from attendance_records where org_id = $1',
      'delete from daily_checkins where org_id = $1',
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
        `/api/daily-checkins${path}`,
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
  const checkins = async (studentId: string) =>
    (await q('select 1 from daily_checkins where student_id = $1', [studentId])).length;
  const exists = async (id: string) =>
    (await q('select 1 from daily_checkins where id = $1', [id])).length === 1;

  it('POST：受限 C1 替 C2 學生打卡（不論填哪個分校）→ 403 不寫；空範圍 403；不存在 404；C1 學生 201；不受限替 C2 學生 201', async () => {
    const before = await checkins(fx.sX);
    const post = (scope: Scope, studentId: string, campusId?: string) =>
      call(scope, 'POST', '', { studentId, campusId, checkinDate: day, source: 'manual' });
    expect((await post('c1', fx.sX, ctx.c2)).status).toBe(403);
    expect((await post('c1', fx.sX, ctx.c1)).status).toBe(403);
    expect((await post('c1', fx.sX)).status).toBe(403);
    expect(await checkins(fx.sX)).toBe(before);
    expect((await post('none', fx.sA, ctx.c1)).status).toBe(403);
    expect(await checkins(fx.sA)).toBe(0);
    expect((await post('c1', crypto.randomUUID(), ctx.c1)).status).toBe(404);
    expect((await post('c1', fx.sA, ctx.c1)).status).toBe(201);
    expect(await checkins(fx.sA)).toBe(1);
    expect((await post('all', fx.sX, ctx.c2)).status).toBeLessThan(300);
  });

  it('POST：受限 C1 替自己的 C1 學生打卡、但 campusId 填 C2（範圍外）→ 403 且打卡不增', async () => {
    const before = await checkins(fx.sA);
    const res = await call('c1', 'POST', '', {
      studentId: fx.sA,
      campusId: ctx.c2,
      checkinDate: addDay(day),
      source: 'manual',
    });
    expect(res.status).toBe(403);
    expect(await checkins(fx.sA)).toBe(before);
  });

  it('DELETE /:id：受限 C1 刪 C2 的打卡（記分校的、沒記分校退回學生分校的）→ 403 且還在；空範圍 403；不受限刪得掉', async () => {
    expect((await call('c1', 'DELETE', `/${fx.dCampus}`)).status).toBe(403);
    expect((await call('c1', 'DELETE', `/${fx.dLegacy}`)).status).toBe(403);
    expect(await exists(fx.dCampus)).toBe(true);
    expect(await exists(fx.dLegacy)).toBe(true);
    expect((await call('none', 'DELETE', `/${fx.dCampus}`)).status).toBe(403);
    expect((await call('c1', 'DELETE', `/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await call('all', 'DELETE', `/${fx.dCampus}`)).status).toBeLessThan(300);
    expect(await exists(fx.dCampus)).toBe(false);
  });
});

function addDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
