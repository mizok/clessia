// scope-contract: GET /api/leave-streaks
// scope-contract: GET /api/leave-streaks/students/:id
// scope-contract: POST /api/leave-streaks/students/:id/reviews
// scope-contract: DELETE /api/leave-streaks/students/:id/reviews/:reviewId
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493：連續請假的帳單頁清單、學生明細、標為已處理、復原看分校範圍**（保留類：授權範圍；請假與帳單），
 * 對真的本機 PostgREST＋Postgres 跑。
 *
 * 判準同 GET /students/:id（outOfCampusScope）：範圍外的學生清單不吐、明細／標記／復原 404 不寫。
 * fixture：C1、C2 各一班（週一、三、四有課）；學生 sA（C1）、sX（C2）各請週一～週四的假＝各一段達標；
 * 兩位各有一筆「已處理」紀錄（復原用）。管理員只被指派 C1。
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

run('#2493 連續請假看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { sA: '', sX: '', rA: '', rX: '' };
  const today = new Date().toISOString().slice(0, 10);
  const addDays = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const MON = addDays(today, -28 - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const WED = addDays(MON, 2);
  const THU = addDays(MON, 3);

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one(
      "insert into organizations (name, leave_waiver_days) values ('#2493 契約：連續請假範圍', 3)",
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
    const campusOf: Record<string, string> = {};
    for (const [studentId, key] of [
      [fx.sA, 'c1'],
      [fx.sX, 'c2'],
    ] as const) {
      const classId = klass[key]!;
      campusOf[studentId] = classId;
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, effective_from)
         values ($1, $2, $3, 'active', 'session_pack', $4)`,
        [ctx.orgId, classId, studentId, addDays(MON, -30)],
      );
      const [{ campus_id }] = await q<{ campus_id: string }>(
        'select campus_id from classes where id = $1',
        [classId],
      );
      for (const day of [MON, WED, THU]) {
        const event = await one(
          `insert into events (org_id, event_type, title, event_date, start_time, end_time, campus_id)
           values ($1, 'session', '課', $2, '18:00', '20:00', $3)`,
          [ctx.orgId, day, campus_id],
        );
        await q(
          `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, event_id, assignment_status)
           values ($1, $2, $3, '18:00', '20:00', 'scheduled', $4, 'unassigned')`,
          [ctx.orgId, classId, day, event],
        );
      }
      await q(
        `insert into leave_requests (org_id, student_id, start_date, end_date, submitted_by, submitted_by_role)
         values ($1, $2, $3, $4, $5, 'admin')`,
        [ctx.orgId, studentId, MON, THU, ctx.userId],
      );
    }
    const review = (studentId: string) =>
      one(
        `insert into leave_streak_reviews (org_id, student_id, first_day, last_day, reviewed_by)
         values ($1, $2, $3, $4, $5)`,
        [ctx.orgId, studentId, MON, THU, ctx.userId],
      );
    fx.rA = await review(fx.sA);
    fx.rX = await review(fx.sX);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from leave_streak_reviews where org_id = $1',
      'delete from leave_requests where org_id = $1',
      'delete from sessions where org_id = $1',
      'delete from events where org_id = $1',
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
        `/api/leave-streaks${path}`,
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
  const reviewsOf = async (studentId: string) =>
    (await q('select 1 from leave_streak_reviews where student_id = $1', [studentId])).length;
  const listed = async (scope: Scope) => {
    const res = await call(scope, 'GET', `?studentIds=${fx.sA},${fx.sX}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: { studentId: string }[] }).data.map((r) => r.studentId);
  };

  it('GET /：受限 C1 的清單只有 C1 學生（沒有 C2 那位）；空範圍沒有；不受限兩位都有', async () => {
    // 先把兩位的「已處理」收掉，清單才會有段可回
    await q('delete from leave_streak_reviews where org_id = $1', [ctx.orgId]);
    expect(await listed('c1')).toEqual([fx.sA]);
    expect(await listed('none')).toEqual([]);
    expect((await listed('all')).sort()).toEqual([fx.sA, fx.sX].sort());
    fx.rA = await one(
      'insert into leave_streak_reviews (org_id, student_id, first_day, last_day, reviewed_by) values ($1, $2, $3, $4, $5)',
      [ctx.orgId, fx.sA, MON, THU, ctx.userId],
    );
    fx.rX = await one(
      'insert into leave_streak_reviews (org_id, student_id, first_day, last_day, reviewed_by) values ($1, $2, $3, $4, $5)',
      [ctx.orgId, fx.sX, MON, THU, ctx.userId],
    );
  });

  it('GET /students/:id：受限 C1 讀 C1 學生 200；C2 學生 404 且不洩漏；空範圍 404；不受限照常', async () => {
    const ok = await call('c1', 'GET', `/students/${fx.sA}`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { data: unknown[] }).data.length).toBeGreaterThan(0);
    const out = await call('c1', 'GET', `/students/${fx.sX}`);
    expect(out.status).toBe(404);
    expect(JSON.stringify(await out.json())).not.toContain('乙生');
    expect((await call('none', 'GET', `/students/${fx.sA}`)).status).toBe(404);
    expect((await call('all', 'GET', `/students/${fx.sX}`)).status).toBe(200);
  });

  it('POST /students/:id/reviews：受限 C1 對 C2 學生 404 不寫；空範圍 404；C1 學生 201；不受限對 C2 照常', async () => {
    await q('delete from leave_streak_reviews where org_id = $1', [ctx.orgId]);
    const body = { firstDay: MON, lastDay: THU };
    expect((await call('c1', 'POST', `/students/${fx.sX}/reviews`, body)).status).toBe(404);
    expect(await reviewsOf(fx.sX)).toBe(0);
    expect((await call('none', 'POST', `/students/${fx.sA}/reviews`, body)).status).toBe(404);
    expect(await reviewsOf(fx.sA)).toBe(0);
    expect((await call('c1', 'POST', `/students/${fx.sA}/reviews`, body)).status).toBe(201);
    expect((await call('all', 'POST', `/students/${fx.sX}/reviews`, body)).status).toBe(201);
    expect(await reviewsOf(fx.sX)).toBe(1);
    await q('delete from leave_streak_reviews where org_id = $1', [ctx.orgId]);
    fx.rA = await one(
      'insert into leave_streak_reviews (org_id, student_id, first_day, last_day, reviewed_by) values ($1, $2, $3, $4, $5)',
      [ctx.orgId, fx.sA, MON, THU, ctx.userId],
    );
    fx.rX = await one(
      'insert into leave_streak_reviews (org_id, student_id, first_day, last_day, reviewed_by) values ($1, $2, $3, $4, $5)',
      [ctx.orgId, fx.sX, MON, THU, ctx.userId],
    );
  });

  it('DELETE /students/:id/reviews/:reviewId：受限 C1 復原 C2 的處理 404 且還在；空範圍 404；C1 的 204；不受限復原 C2', async () => {
    expect((await call('c1', 'DELETE', `/students/${fx.sX}/reviews/${fx.rX}`)).status).toBe(404);
    expect(await reviewsOf(fx.sX)).toBe(1);
    expect((await call('none', 'DELETE', `/students/${fx.sA}/reviews/${fx.rA}`)).status).toBe(404);
    expect(await reviewsOf(fx.sA)).toBe(1);
    expect((await call('c1', 'DELETE', `/students/${fx.sA}/reviews/${fx.rA}`)).status).toBe(204);
    expect(await reviewsOf(fx.sA)).toBe(0);
    expect((await call('all', 'DELETE', `/students/${fx.sX}/reviews/${fx.rX}`)).status).toBe(204);
  });
});
