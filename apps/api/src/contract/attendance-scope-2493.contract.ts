// scope-contract: GET /api/attendance
// scope-contract: GET /api/attendance/sessions
// scope-contract: GET /api/attendance/student-day
// scope-contract: GET /api/attendance/roster/:eventId
// scope-contract: POST /api/attendance
// scope-contract: PATCH /api/attendance/batch
// scope-contract: PATCH /api/attendance/:id
// scope-contract: POST /api/attendance/roster/:eventId/cancel-leave
// scope-contract: POST /api/attendance/roster/:eventId/check-in
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

/**
 * **#2493 上半：出勤 9 支舊端點的分校範圍契約認領**（保留類：授權範圍），對真的本機 PostgREST＋Postgres 跑。
 * 盤點時範圍已 OK（讀取用 `applyCampusFilter`，寫入與名單用 `resourceCampusAllowed` 比課堂的分校），這裡把它釘住。
 *
 * fixture：C1、C2；C2 班今天一堂課（含 event）、只在 C2 報名的「二校生」在那堂有一筆缺席紀錄。管理員只被指派 C1。
 * 受限 C1：三支列表讀不到那堂／那筆；名單 404；新增、批次點名、改單筆、取消請假、到班打卡一律 403，紀錄沒變。
 * 範圍內放：C1 也有一堂一樣的課，受限 C1 對它讀得到、五支寫入照常；不受限對 C2 也照常。
 * 「照常」＝讀取 200、寫入 2xx；取消請假回 404「這個學生當天沒有請假」（找到課堂、過了範圍）。
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

run('#2493 出勤舊端點看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const TODAY = getCurrentTaipeiDateString();
  const fx = { c1: '', c2: '', s2: '', s3: '', event: '', session: '', record: '' };
  /** C1 那一份（範圍內放）：同樣一堂課、一位有紀錄、一位沒紀錄 */
  const own = { s1: '', s1b: '', event: '', session: '', record: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：出勤範圍')", []);
    fx.c1 = await one("insert into campuses (org_id, name) values ($1, 'C1')", [ctx.orgId]);
    fx.c2 = await one("insert into campuses (org_id, name) values ($1, 'C2')", [ctx.orgId]);
    const subject = await one("insert into subjects (org_id, name) values ($1, '數學')", [
      ctx.orgId,
    ]);
    const course = await one(
      'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
      [ctx.orgId, fx.c2, '數學 C2', subject],
    );
    const klass = await one(
      'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
      [ctx.orgId, fx.c2, course, '班 C2'],
    );
    fx.s2 = await one("insert into students (org_id, name, grade) values ($1, '二校生', 'J2')", [
      ctx.orgId,
    ]);
    // 二校生有一筆紀錄；三校生（同在 C2）沒有，給「新增一筆」用（同一人同一堂只能有一筆）
    fx.s3 = await one("insert into students (org_id, name, grade) values ($1, '二校新生', 'J2')", [
      ctx.orgId,
    ]);
    for (const student of [fx.s2, fx.s3]) {
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
        [ctx.orgId, klass, student],
      );
    }
    fx.event = await one(
      `insert into events (org_id, event_type, title, event_date, start_time, end_time, campus_id)
       values ($1, 'session', '二校的課', $2, '08:00', '09:00', $3)`,
      [ctx.orgId, TODAY, fx.c2],
    );
    fx.session = await one(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status, event_id)
       values ($1, $2, $3, '08:00', '09:00', 'scheduled', 'unassigned', $4)`,
      [ctx.orgId, klass, TODAY, fx.event],
    );
    fx.record = await one(
      `insert into attendance_records (org_id, event_id, student_id, status)
       values ($1, $2, $3, 'absent')`,
      [ctx.orgId, fx.event, fx.s2],
    );
    const course1 = await one(
      'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
      [ctx.orgId, fx.c1, '數學 C1', subject],
    );
    const class1 = await one(
      'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
      [ctx.orgId, fx.c1, course1, '班 C1'],
    );
    for (const key of ['s1', 's1b'] as const) {
      own[key] = await one("insert into students (org_id, name, grade) values ($1, $2, 'J2')", [
        ctx.orgId,
        key === 's1' ? '一校生' : '一校新生',
      ]);
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
        [ctx.orgId, class1, own[key]],
      );
    }
    own.event = await one(
      `insert into events (org_id, event_type, title, event_date, start_time, end_time, campus_id)
       values ($1, 'session', '一校的課', $2, '08:00', '09:00', $3)`,
      [ctx.orgId, TODAY, fx.c1],
    );
    own.session = await one(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status, event_id)
       values ($1, $2, $3, '08:00', '09:00', 'scheduled', 'unassigned', $4)`,
      [ctx.orgId, class1, TODAY, own.event],
    );
    own.record = await one(
      `insert into attendance_records (org_id, event_id, student_id, status)
       values ($1, $2, $3, 'absent')`,
      [ctx.orgId, own.event, own.s1],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from attendance_records where org_id = $1',
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

  const call = async (scope: 'all' | 'c1', method: string, path: string, body?: unknown) => {
    ctx.campusScope = scope === 'all' ? null : [fx.c1];
    try {
      return await app.request(
        `/api/attendance${path}`,
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
  const records = async () =>
    JSON.stringify(
      await q('select student_id, status, note from attendance_records where event_id = $1', [
        fx.event,
      ]),
    );
  const text = async (scope: 'all' | 'c1', path: string) => {
    const res = await call(scope, 'GET', path);
    expect(`${path} → ${res.status}`).toBe(`${path} → 200`);
    return JSON.stringify(await res.json());
  };

  /** 五支寫入：event／record 是哪一堂的、who 有紀錄、fresh 沒紀錄（新增用） */
  const writesFor = (
    event: string,
    record: string,
    who: string,
    fresh: string,
  ): Array<[string, string, unknown]> => [
    ['POST', '', { studentId: fresh, eventId: event, status: 'present' }],
    ['PATCH', '/batch', { eventId: event, updates: [{ studentId: who, status: 'present' }] }],
    ['PATCH', `/${record}`, { status: 'present', note: '改了' }],
    ['POST', `/roster/${event}/cancel-leave`, { studentId: who }],
    ['POST', `/roster/${event}/check-in`, { studentId: who }],
  ];
  /** 過得了範圍：寫入 2xx；取消請假的正確結果是 404「這個學生當天沒有請假」（找到了課堂、他沒請假） */
  const expectPasses = async (scope: 'all' | 'c1', writes: Array<[string, string, unknown]>) => {
    for (const [method, path, body] of writes) {
      const res = await call(scope, method, path, body);
      const got = `${scope} ${method} ${path} → ${res.status} ${JSON.stringify(await res.json())}`;
      if (path.endsWith('/cancel-leave'))
        expect(got).toContain('→ 404 {"error":"這個學生當天沒有請假"');
      else expect(got).toMatch(/→ 20\d /);
    }
  };

  it('三支列表：受限 C1 讀不到二校的課與紀錄；不受限讀得到', async () => {
    const list = `?dateFrom=${TODAY}&dateTo=${TODAY}`;
    expect(await text('c1', list)).not.toContain(fx.record);
    expect(await text('all', list)).toContain(fx.record);
    const sessions = `/sessions?date=${TODAY}`;
    expect(await text('c1', sessions)).not.toContain(fx.session);
    expect(await text('all', sessions)).toContain(fx.session);
    const day = `/student-day?studentId=${fx.s2}&date=${TODAY}`;
    expect(await text('c1', day)).not.toContain(fx.session);
    expect(await text('all', day)).toContain(fx.session);
  });

  it('名單與五支寫入：受限 C1 → 名單 404、寫入 403，紀錄沒變；不受限過得了範圍那一關', async () => {
    const roster = await call('c1', 'GET', `/roster/${fx.event}`);
    expect(roster.status).toBe(404);
    expect(JSON.stringify(await roster.json())).not.toContain('二校生');
    expect(await text('all', `/roster/${fx.event}`)).toContain('二校生');

    const writes = writesFor(fx.event, fx.record, fx.s2, fx.s3);
    const before = await records();
    for (const [method, path, body] of writes) {
      expect(`${method} ${path} → ${(await call('c1', method, path, body)).status}`).toBe(
        `${method} ${path} → 403`,
      );
    }
    expect(await records()).toBe(before);
    await expectPasses('all', writes);
  });

  it('範圍內放：受限 C1 讀得到一校的課與紀錄、名單 200，五支寫入照常', async () => {
    const list = `?dateFrom=${TODAY}&dateTo=${TODAY}`;
    expect(await text('c1', list)).toContain(own.record);
    expect(await text('c1', `/sessions?date=${TODAY}`)).toContain(own.session);
    expect(await text('c1', `/student-day?studentId=${own.s1}&date=${TODAY}`)).toContain(
      own.session,
    );
    expect(await text('c1', `/roster/${own.event}`)).toContain('一校生');
    await expectPasses('c1', writesFor(own.event, own.record, own.s1, own.s1b));
  });
});
