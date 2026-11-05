import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **`GET /api/workbench/today` 整支不碰 PostgREST**（#1595 P2 ①），對本機真 DB 跑。
 *
 * 管理端首頁冷開必經這支。原本第一波的點名模式＋課堂、日到班的在籍＋打卡＋請假都走 REST：
 * 正式站每支 REST 23–443ms，請求裡的第一支還要再付 TLS。改成 pg 之後要守三件事：
 * 1. 一支 REST 都不打（舊碼 2–5 支 → 紅）
 * 2. 回應的內容照舊：課堂摘要、點名名單、應到／到了／請假逐欄寫死
 * 3. 範圍照舊：分校範圍（不受限／一間／沒指派）、別的 org 不混進來
 *
 * fixture：A 校兩個班（KA1 有課、KA2 停課）、B 校一個班 KB，每班兩個學生；同一天別的 org 也有一堂課、
 * 一個學生、一筆打卡、一張假。
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

const ctx: { orgId: string; userId: string; campusScope: string[] | null } = {
  orgId: '',
  userId: '',
  campusScope: null,
};

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
      set('campusScope', ctx.campusScope);
      set('auth', {
        pool: {
          query: pool!.query.bind(pool),
          connect: pool!.connect.bind(pool),
          end: async () => undefined,
        },
      });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: ctx.campusScope ?? [] });
      await next();
    }),
  };
});

const D = '2027-04-07';

interface Body {
  mode: string;
  sessions: Array<Record<string, unknown>>;
  rosters: Array<{ eventId: string; enrolledCount: number; presentCount: number }>;
  expected: Array<{ studentId: string; studentName: string; campusName: string | null }>;
  arrived: Array<{ studentId: string }>;
  onLeave: Array<{ studentId: string; studentName: string }>;
}

run('作業台今天：整支走 pg，內容與範圍照舊（#1595 P2 ①）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = {
    otherOrg: '',
    campusA: '',
    campusB: '',
    /** 班名 → 兩個學生 id */
    students: {} as Record<string, [string, string]>,
    events: {} as Record<string, string>,
    otherStudent: '',
  };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    const [teacherUser] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'teacher' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one(
      "insert into organizations (name) values ('#1595 P2 ① 契約：作業台')",
      [],
    );
    fx.otherOrg = await one(
      "insert into organizations (name) values ('#1595 P2 ① 契約：別的 org')",
      [],
    );
    fx.campusA = await one("insert into campuses (org_id, name) values ($1, 'A 校')", [ctx.orgId]);
    fx.campusB = await one("insert into campuses (org_id, name) values ($1, 'B 校')", [ctx.orgId]);
    const subject = await one("insert into subjects (org_id, name) values ($1, '數學')", [
      ctx.orgId,
    ]);
    const course = await one(
      "insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, '國一數學', $3)",
      [ctx.orgId, fx.campusA, subject],
    );
    const teacher = await one(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '王老師')",
      [ctx.orgId, teacherUser!.user_id],
    );
    const klass = (name: string, campus: string, contactBook = false) =>
      one(
        'insert into classes (org_id, campus_id, course_id, name, uses_contact_book) values ($1, $2, $3, $4, $5)',
        [ctx.orgId, campus, course, name, contactBook],
      );
    const classes = {
      KA1: await klass('KA1', fx.campusA, true),
      KA2: await klass('KA2', fx.campusA),
      KB: await klass('KB', fx.campusB),
    };
    const schedule = await one(
      `insert into schedules (class_id, weekday, start_time, end_time, teacher_id, effective_from)
       values ($1, 3, '09:00', '10:00', $2, '2027-01-01')`,
      [classes.KA1, teacher],
    );
    const session = async (
      name: keyof typeof classes,
      start: string,
      status: string,
      teacherId: string | null,
      scheduleId: string | null,
    ) => {
      const event = await one(
        `insert into events (org_id, event_type, title, event_date, start_time, end_time, campus_id)
         values ($1, 'session', $2, $3, $4, $4::time + interval '1 hour', $5)`,
        [ctx.orgId, name, D, start, name === 'KB' ? fx.campusB : fx.campusA],
      );
      fx.events[name] = event;
      await q(
        `insert into sessions (org_id, class_id, session_date, start_time, end_time, status,
                               assignment_status, teacher_id, schedule_id, event_id)
         values ($1, $2, $3, $4, $4::time + interval '1 hour', $5, $6, $7, $8, $9)`,
        [
          ctx.orgId,
          classes[name],
          D,
          start,
          status,
          teacherId ? 'assigned' : 'unassigned',
          teacherId,
          scheduleId,
          event,
        ],
      );
    };
    await session('KA1', '09:00', 'scheduled', teacher, schedule);
    await session('KA2', '10:00', 'cancelled', null, null);
    await session('KB', '11:00', 'scheduled', null, null);

    for (const name of ['KA1', 'KA2', 'KB'] as const) {
      const ids: string[] = [];
      for (const k of [1, 2]) {
        const student = await one(
          "insert into students (org_id, name, grade) values ($1, $2, 'J1')",
          [ctx.orgId, `${name}-${k}`],
        );
        await q(
          `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
           values ($1, $2, $3, 'active', 'monthly', 1000, '2027-01-01')`,
          [ctx.orgId, classes[name], student],
        );
        ids.push(student);
      }
      fx.students[name] = ids as [string, string];
    }
    // KA1：第 1 位點了出席、到班打了卡；第 2 位請整天假。KB：第 1 位打卡、第 2 位請假
    await q(
      `insert into attendance_records (org_id, event_id, student_id, status) values ($1, $2, $3, 'present')`,
      [ctx.orgId, fx.events['KA1'], fx.students['KA1']![0]],
    );
    for (const name of ['KA1', 'KB'] as const) {
      await q(
        `insert into daily_checkins (org_id, campus_id, student_id, checkin_date, checked_in_at)
         values ($1, $2, $3, $4, $5)`,
        [
          ctx.orgId,
          name === 'KB' ? fx.campusB : fx.campusA,
          fx.students[name]![0],
          D,
          `${D}T00:30:00Z`,
        ],
      );
      await q(
        `insert into leave_requests (org_id, student_id, start_date, end_date, reason, submitted_by, submitted_by_role)
         values ($1, $2, $3, $3, '感冒', $4, 'parent')`,
        [ctx.orgId, fx.students[name]![1], D, ctx.userId],
      );
    }

    // 別的 org：同一天一堂課、一個學生（打卡、請假都有）
    const oCampus = await one("insert into campuses (org_id, name) values ($1, '別校')", [
      fx.otherOrg,
    ]);
    const oSubject = await one("insert into subjects (org_id, name) values ($1, '別科')", [
      fx.otherOrg,
    ]);
    const oCourse = await one(
      "insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, '別的課', $3)",
      [fx.otherOrg, oCampus, oSubject],
    );
    const oClass = await one(
      "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '別的班')",
      [fx.otherOrg, oCampus, oCourse],
    );
    await q(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
       values ($1, $2, $3, '08:00', '09:00', 'scheduled', 'unassigned')`,
      [fx.otherOrg, oClass, D],
    );
    fx.otherStudent = await one(
      "insert into students (org_id, name, grade) values ($1, '別人', 'J1')",
      [fx.otherOrg],
    );
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       values ($1, $2, $3, 'active', 'monthly', 1000, '2027-01-01')`,
      [fx.otherOrg, oClass, fx.otherStudent],
    );
    await q(
      `insert into daily_checkins (org_id, campus_id, student_id, checkin_date) values ($1, $2, $3, $4)`,
      [fx.otherOrg, oCampus, fx.otherStudent, D],
    );
    await q(
      `insert into leave_requests (org_id, student_id, start_date, end_date, submitted_by, submitted_by_role)
       values ($1, $2, $3, $3, $4, 'parent')`,
      [fx.otherOrg, fx.otherStudent, D, ctx.userId],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    for (const org of [ctx.orgId, fx.otherOrg].filter(Boolean)) {
      for (const sql of [
        'delete from attendance_records where org_id = $1',
        'delete from daily_checkins where org_id = $1',
        'delete from leave_requests where org_id = $1',
        'delete from sessions where org_id = $1',
        'delete from events where org_id = $1',
        'delete from enrollments where org_id = $1',
        'delete from students where org_id = $1',
        'delete from schedules where class_id in (select id from classes where org_id = $1)',
        'delete from classes where org_id = $1',
        'delete from courses where org_id = $1',
        'delete from subjects where org_id = $1',
        'delete from staff where org_id = $1',
        'delete from campuses where org_id = $1',
        'delete from audit_logs where org_id = $1',
        'delete from organizations where id = $1',
      ]) {
        await q(sql, [org]);
      }
    }
  }, 120_000);

  /** 打一次，順便數這次打了幾支 PostgREST */
  const today = async (mode: 'per_session' | 'daily_checkin', scope: string[] | null, qs = '') => {
    await q('update organizations set attendance_mode = $2 where id = $1', [ctx.orgId, mode]);
    ctx.campusScope = scope;
    const spy = vi.spyOn(globalThis, 'fetch');
    try {
      const res = await app.request(`/api/workbench/today?date=${D}${qs}`, {}, env);
      const rest = spy.mock.calls.filter((c) => String(c[0]).includes('/rest/v1/')).length;
      return { status: res.status, rest, body: (await res.json()) as Body };
    } finally {
      spy.mockRestore();
    }
  };
  const names = (rows: Array<{ studentName?: string }>) => rows.map((r) => r.studentName).sort();
  const ids = (rows: Array<{ studentId: string }>) => rows.map((r) => r.studentId).sort();

  it('整支請求不打 PostgREST（兩種模式、受限與不受限）', async () => {
    for (const mode of ['per_session', 'daily_checkin'] as const) {
      for (const scope of [null, [fx.campusA]]) {
        const r = await today(mode, scope);
        expect(r.status).toBe(200);
        expect({ mode, scope, rest: r.rest }).toEqual({ mode, scope, rest: 0 });
      }
    }
  });

  it('逐堂點名（不受限）：三堂課的摘要逐欄照舊、點名名單只列沒停課的；別 org 的課不在', async () => {
    const { body } = await today('per_session', null);
    expect(body.mode).toBe('per_session');
    expect(body.sessions.map((s) => s['className'])).toEqual(['KA1', 'KA2', 'KB']);
    expect(body.sessions[0]).toMatchObject({
      eventId: fx.events['KA1'],
      status: 'scheduled',
      isSubstitute: false,
      className: 'KA1',
      usesContactBook: true,
      courseName: '國一數學',
      teacherName: '王老師',
      campusId: fx.campusA,
      campusName: 'A 校',
      eventDate: D,
      startTime: '09:00',
      endTime: '10:00',
      enrolledCount: 2,
      presentCount: 1,
    });
    expect(body.sessions[1]).toMatchObject({ status: 'cancelled', teacherName: null });
    expect(body.sessions[2]).toMatchObject({ campusName: 'B 校', startTime: '11:00' });
    expect(body.rosters.map((r) => r.eventId).sort()).toEqual(
      [fx.events['KA1'], fx.events['KA2'], fx.events['KB']].sort(),
    );
    expect(body.expected).toEqual([]);
  });

  it('逐堂點名（受限：只管 A 校）：B 校的課不在；沒被指派任何分校：一堂都沒有', async () => {
    const a = await today('per_session', [fx.campusA]);
    expect(a.body.sessions.map((s) => s['className'])).toEqual(['KA1', 'KA2']);
    const none = await today('per_session', []);
    expect(none.status).toBe(200);
    expect(none.body.sessions).toEqual([]);
  });

  it('日到班（不受限）：應到＝有課（沒停課）班的學生；請假的照列；別 org 的人不在', async () => {
    const { body } = await today('daily_checkin', null);
    expect(body.mode).toBe('daily_checkin');
    expect(names(body.expected)).toEqual(['KA1-1', 'KA1-2', 'KB-1', 'KB-2']);
    expect(body.expected.find((s) => s.studentName === 'KB-1')?.campusName).toBe('B 校');
    expect(ids(body.arrived)).toEqual([fx.students['KA1']![0], fx.students['KB']![0]].sort());
    expect(names(body.onLeave)).toEqual(['KA1-2', 'KB-2']);
    expect(JSON.stringify(body)).not.toContain(fx.otherStudent);
    expect(body.rosters).toEqual([]);
  });

  it('日到班（受限：只管 A 校）：應到與請假只剩 A 校；停課班的學生不該到', async () => {
    const { body } = await today('daily_checkin', [fx.campusA]);
    expect(names(body.expected)).toEqual(['KA1-1', 'KA1-2']);
    expect(names(body.onLeave)).toEqual(['KA1-2']);
    expect(JSON.stringify(body.expected)).not.toContain(fx.students['KA2']![0]);
  });

  it('帶 campusId（範圍內）：只看那個分校', async () => {
    const { body } = await today('daily_checkin', null, `&campusId=${fx.campusB}`);
    expect(body.sessions.map((s) => s['className'])).toEqual(['KB']);
    expect(names(body.expected)).toEqual(['KB-1', 'KB-2']);
  });
});
