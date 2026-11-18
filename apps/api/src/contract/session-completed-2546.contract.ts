import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2546 課堂生命週期**：點名提交 → `sessions.status = completed`（點名制分校；日到班不動），
 * 已點名的堂可停課、復課回 completed、代課放行、改期仍擋。對真的本機 PostgREST＋Postgres 跑。
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

const ctx = { orgId: '', userId: '', roles: ['admin'] as string[] };

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
      set('roles', ctx.roles);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', ctx.roles[0]);
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', null);
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

run('#2546 課堂點名提交與狀態遷移', () => {
  let app: {
    request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response>;
  };
  const env = {
    ENVIRONMENT: 'contract',
    WEB_URL: 'http://localhost:4200',
    ALLOWED_ORIGINS: '',
  };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = {
    campus: '',
    daily: '',
    klass: '',
    dailyClass: '',
    student: '',
    teacherA: '',
    teacherB: '',
    subject: '',
    course: '',
  };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one(
      "insert into organizations (name, attendance_mode) values ('#2546 契約：課堂生命週期', 'per_session')",
      [],
    );
    fx.campus = await one("insert into campuses (org_id, name) values ($1, 'A 校')", [ctx.orgId]);
    fx.daily = await one(
      "insert into campuses (org_id, name, attendance_mode) values ($1, 'B 校', 'daily_checkin')",
      [ctx.orgId],
    );
    fx.subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    fx.course = await one(
      'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
      [ctx.orgId, fx.campus, '數學', fx.subject],
    );
    fx.klass = await newClass(fx.campus, '點名制班');
    fx.dailyClass = await newClass(fx.daily, '日到班班');
    fx.student = await one("insert into students (org_id, name, grade) values ($1, '甲生', 'J1')", [
      ctx.orgId,
    ]);
    for (const classId of [fx.klass, fx.dailyClass])
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
        [ctx.orgId, classId, fx.student],
      );
    // 兩位老師（沿用 seed 的兩個 teacher 帳號）：A 是原老師、B 是代課，B 要有科目與分校資格
    const staff = (userId: string, name: string) =>
      one('insert into staff (org_id, user_id, display_name) values ($1, $2, $3)', [
        ctx.orgId,
        userId,
        name,
      ]);
    fx.teacherA = await staff('40000000-0000-0000-0000-000000000001', '原老師');
    fx.teacherB = await staff('40000000-0000-0000-0000-000000000002', '代課老師');
    await q('insert into staff_subjects (staff_id, subject_id) values ($1, $2)', [
      fx.teacherB,
      fx.subject,
    ]);
    await q('insert into staff_campuses (staff_id, campus_id) values ($1, $2)', [
      fx.teacherB,
      fx.campus,
    ]);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from attendance_records where org_id = $1',
      'delete from schedule_changes where org_id = $1',
      'delete from sessions where org_id = $1',
      'delete from events where org_id = $1',
      'delete from staff where org_id = $1',
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

  const newClass = (campus: string, name: string) =>
    one('insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)', [
      ctx.orgId,
      campus,
      fx.course,
      name,
    ]);

  let seq = 0;
  /** 一堂課＋它的 event。日期預設過去（點名不收未來課堂）；每堂換日期，避開同班同時段的唯一索引 */
  const mk = async (
    opts: {
      klass?: string;
      campus?: string;
      status?: string;
      date?: string;
      takenAt?: boolean;
      noEvent?: boolean;
      teacher?: string;
    } = {},
  ) => {
    seq += 1;
    const campus = opts.campus ?? fx.campus;
    const date = opts.date ?? new Date(Date.UTC(2026, 0, 1 + seq)).toISOString().slice(0, 10);
    const eventId = opts.noEvent
      ? null
      : await one(
          `insert into events (org_id, event_type, title, event_date, start_time, end_time, campus_id, attendance_taken_at)
           values ($1, 'session', 't', $2, '10:00', '11:00', $3, $4)`,
          [ctx.orgId, date, campus, opts.takenAt ? new Date().toISOString() : null],
        );
    const sessionId = await one(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status, teacher_id, event_id)
       values ($1, $2, $3, '10:00', '11:00', $4, $5, $6, $7)`,
      [
        ctx.orgId,
        opts.klass ?? fx.klass,
        date,
        opts.status ?? 'scheduled',
        opts.teacher ? 'assigned' : 'unassigned',
        opts.teacher ?? null,
        eventId,
      ],
    );
    return { sessionId, eventId: eventId! };
  };
  const status = async (sessionId: string) =>
    (await q<{ status: string }>('select status from sessions where id = $1', [sessionId]))[0]!
      .status;
  const takenAt = async (eventId: string) =>
    (
      await q<{ t: string | null }>(
        'select attendance_taken_at::text t from events where id = $1',
        [eventId],
      )
    )[0]!.t;
  const records = async (eventId: string) =>
    Number(
      (
        await q<{ n: string }>('select count(*) n from attendance_records where event_id = $1', [
          eventId,
        ])
      )[0]!.n,
    );
  const call = (method: string, path: string, body?: unknown) =>
    app.request(
      path,
      {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
  const submit = (eventId: string) =>
    call('PATCH', '/api/attendance/batch', {
      eventId,
      updates: [{ studentId: fx.student, status: 'present' }],
    });

  describe('點名提交 → completed', () => {
    it('點名制：第一次提交 → completed、taken_at 有值；再提交一次 → 仍 completed、taken_at 不變', async () => {
      const s = await mk();
      expect((await submit(s.eventId)).status).toBe(200);
      expect(await status(s.sessionId)).toBe('completed');
      const first = await takenAt(s.eventId);
      expect(first).not.toBeNull();
      expect((await submit(s.eventId)).status).toBe(200);
      expect(await status(s.sessionId)).toBe('completed');
      expect(await takenAt(s.eventId)).toBe(first);
    });

    it('日到班校區：提交只寫 taken_at，status 維持 scheduled', async () => {
      const s = await mk({ klass: fx.dailyClass, campus: fx.daily });
      expect((await submit(s.eventId)).status).toBe(200);
      expect(await takenAt(s.eventId)).not.toBeNull();
      expect(await status(s.sessionId)).toBe('scheduled');
    });

    it('已停課的堂補登出勤：status 維持 cancelled', async () => {
      const s = await mk({ status: 'cancelled' });
      expect((await submit(s.eventId)).status).toBe(200);
      expect(await status(s.sessionId)).toBe('cancelled');
    });

    it('taken_at 已寫但 status 還是 scheduled（上次收斂失敗）：下一次提交補回 completed', async () => {
      const s = await mk({ takenAt: true });
      expect(await status(s.sessionId)).toBe('scheduled');
      expect((await submit(s.eventId)).status).toBe(200);
      expect(await status(s.sessionId)).toBe('completed');
    });
  });

  describe('停課', () => {
    it('單堂停課：completed → cancelled，出勤紀錄與 taken_at 保留；再停一次 409', async () => {
      const s = await mk();
      await submit(s.eventId);
      const taken = await takenAt(s.eventId);
      const res = await call('POST', `/api/sessions/${s.sessionId}/cancel`, {});
      expect(res.status).toBe(200);
      expect(await status(s.sessionId)).toBe('cancelled');
      expect(await records(s.eventId)).toBe(1);
      expect(await takenAt(s.eventId)).toBe(taken);
      expect((await call('POST', `/api/sessions/${s.sessionId}/cancel`, {})).status).toBe(409);
    });

    it('批次停課（sessions）：completed 與 scheduled 一起停，出勤保留', async () => {
      const done = await mk();
      await submit(done.eventId);
      const plain = await mk();
      const res = await call('PATCH', '/api/sessions/batch-cancel', {
        sessionIds: [done.sessionId, plain.sessionId],
        dryRun: false,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ updated: 2, skipped: 0 });
      expect(await status(done.sessionId)).toBe('cancelled');
      expect(await records(done.eventId)).toBe(1);
    });

    it('批次停課（classes）：同上', async () => {
      const done = await mk();
      await submit(done.eventId);
      const res = await call('PATCH', `/api/classes/${fx.klass}/sessions/batch-cancel`, {
        sessionIds: [done.sessionId],
        dryRun: false,
      });
      expect(res.status).toBe(200);
      expect(await status(done.sessionId)).toBe('cancelled');
      expect(await records(done.eventId)).toBe(1);
    });

    it('整班停課（未來）略過 completed、照停 scheduled', async () => {
      const klass = await newClass(fx.campus, '整班停課班');
      const done = await mk({ klass, status: 'completed', date: '2099-01-01' });
      const plain = await mk({ klass, date: '2099-01-02' });
      const res = await call('POST', `/api/classes/${klass}/cancel-future-sessions`, {});
      expect(res.status).toBe(200);
      expect(await status(done.sessionId)).toBe('completed');
      expect(await status(plain.sessionId)).toBe('cancelled');
    });
  });

  describe('復課', () => {
    it('已點名的 cancelled 堂 → completed；沒點名 → scheduled；沒有 event → scheduled（sessions 批次）', async () => {
      const taken = await mk({ status: 'cancelled', takenAt: true });
      const plain = await mk({ status: 'cancelled' });
      const noEvent = await mk({ status: 'cancelled', noEvent: true });
      const res = await call('PATCH', '/api/sessions/batch-uncancel', {
        sessionIds: [taken.sessionId, plain.sessionId, noEvent.sessionId],
        dryRun: false,
      });
      expect(res.status).toBe(200);
      expect(await status(taken.sessionId)).toBe('completed');
      expect(await status(plain.sessionId)).toBe('scheduled');
      expect(await status(noEvent.sessionId)).toBe('scheduled');
    });

    it('classes 批次復課：已點名 → completed、沒點名 → scheduled', async () => {
      const taken = await mk({ status: 'cancelled', takenAt: true });
      const plain = await mk({ status: 'cancelled' });
      const res = await call('PATCH', `/api/classes/${fx.klass}/sessions/batch-uncancel`, {
        sessionIds: [taken.sessionId, plain.sessionId],
        dryRun: false,
      });
      expect(res.status).toBe(200);
      expect(await status(taken.sessionId)).toBe('completed');
      expect(await status(plain.sessionId)).toBe('scheduled');
    });

    it('日到班校區已有 taken_at 的 cancelled 堂：復課回 scheduled（日到班不設 completed）', async () => {
      const s = await mk({
        klass: fx.dailyClass,
        campus: fx.daily,
        status: 'cancelled',
        takenAt: true,
      });
      const res = await call('PATCH', '/api/sessions/batch-uncancel', {
        sessionIds: [s.sessionId],
        dryRun: false,
      });
      expect(res.status).toBe(200);
      expect(await status(s.sessionId)).toBe('scheduled');
    });
  });

  describe('改期與代課', () => {
    it('已點名（completed）的堂不能就地改期：409 STATUS_NOT_EDITABLE', async () => {
      const s = await mk();
      await submit(s.eventId);
      const res = await call('POST', `/api/sessions/${s.sessionId}/reschedule`, {
        newSessionDate: '2026-02-20',
        newStartTime: '10:00',
        newEndTime: '11:00',
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'STATUS_NOT_EDITABLE' });
      expect(await status(s.sessionId)).toBe('completed');
    });

    it('已點名的堂可代課（資料更正）：200、status 仍 completed、出勤不變', async () => {
      const s = await mk({ teacher: fx.teacherA });
      await submit(s.eventId);
      expect(await status(s.sessionId)).toBe('completed');
      const res = await call('POST', `/api/sessions/${s.sessionId}/substitute`, {
        substituteTeacherId: fx.teacherB,
      });
      expect({
        status: res.status,
        body: await res.clone().text(),
      }).toMatchObject({
        status: 200,
      });
      const [row] = await q<{ teacher_id: string; status: string }>(
        'select teacher_id, status from sessions where id = $1',
        [s.sessionId],
      );
      expect(row).toEqual({ teacher_id: fx.teacherB, status: 'completed' });
      expect(await records(s.eventId)).toBe(1);
    });

    it('已停課的堂不能代課：409 SESSION_CANCELLED', async () => {
      const s = await mk({ status: 'cancelled', teacher: fx.teacherA });
      const res = await call('POST', `/api/sessions/${s.sessionId}/substitute`, {
        substituteTeacherId: fx.teacherB,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'SESSION_CANCELLED' });
    });
  });
});
