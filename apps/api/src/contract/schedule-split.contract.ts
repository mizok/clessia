import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { splitSchedule, type ScheduleSplitInput } from '../lib/schedule-split';
import classesRoute from '../routes/classes';

/**
 * #1100 #22 寫入面：「從某日起改時段」的交易對**真的** Postgres 跑 —— 排除約束、
 * `effective_to = X − 1`、哪些舊課堂刪掉重產、哪些保留，是 SQL 語意，替身驗不出來。
 *
 * 日期固定在 2030 年（lib 不看今天，「不能早於今天」在路由擋）：
 * 舊段週一 10:00、2030-01-01 起；課堂 01-07、01-14、01-21、01-28（有異動）、02-04（已點名）。
 * 從 01-20（週日）起改成週三 10:00 → 01-21 刪掉，週三 01-23、01-30 重產（到 02-04 為止）。
 * 自己建資料、測完刪掉，不碰 seed。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

run('從某日起改時段的交易對真 Postgres（#1100 #22）', () => {
  const pool = new Pool({ connectionString: DB });
  const orgs: string[] = [];

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const one = async (sql: string, params: unknown[]) =>
    (await q<{ id: string }>(`${sql} RETURNING id`, params))[0]!.id;

  async function org() {
    const orgId = await one(`INSERT INTO organizations (name) VALUES ($1)`, [
      `c22-${randomUUID()}`,
    ]);
    orgs.push(orgId);
    const campusId = await one(`INSERT INTO campuses (org_id, name) VALUES ($1, 'x')`, [orgId]);
    const subjectId = await one(`INSERT INTO subjects (org_id, name) VALUES ($1, 'x')`, [orgId]);
    const courseId = await one(
      `INSERT INTO courses (org_id, campus_id, subject_id, name) VALUES ($1, $2, $3, 'x')`,
      [orgId, campusId, subjectId],
    );
    const classId = await one(
      `INSERT INTO classes (org_id, campus_id, course_id, name) VALUES ($1, $2, $3, $4)`,
      [orgId, campusId, courseId, randomUUID()],
    );
    const scheduleId = await one(
      `INSERT INTO schedules (class_id, weekday, start_time, end_time, effective_from)
       VALUES ($1, 1, '10:00', '11:00', '2030-01-01')`,
      [classId],
    );
    const session = (date: string) =>
      one(
        `INSERT INTO sessions (org_id, class_id, schedule_id, session_date, start_time, end_time, assignment_status)
         VALUES ($1, $2, $3, $4, '10:00', '11:00', 'unassigned')`,
        [orgId, classId, scheduleId, date],
      );
    return { orgId, campusId, classId, scheduleId, session };
  }

  const input = (
    o: { orgId: string; classId: string; scheduleId: string },
    over: Partial<ScheduleSplitInput> = {},
  ): ScheduleSplitInput => ({
    orgId: o.orgId,
    classId: o.classId,
    scheduleId: o.scheduleId,
    scope: null,
    fromDate: '2030-01-20',
    weekday: 3,
    startTime: '10:00',
    endTime: '11:00',
    teacherId: null,
    classroomId: null,
    createdBy: null,
    dryRun: false,
    ...over,
  });

  const sessionsOf = (classId: string) =>
    q<{ session_date: string; schedule_id: string }>(
      `SELECT session_date::text, schedule_id FROM sessions WHERE class_id = $1 ORDER BY session_date`,
      [classId],
    );
  const schedulesOf = (classId: string) =>
    q<{ id: string; weekday: number; effective_from: string; effective_to: string | null }>(
      `SELECT id, weekday, effective_from::text, effective_to::text FROM schedules
       WHERE class_id = $1 ORDER BY effective_from`,
      [classId],
    );

  afterAll(async () => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SET LOCAL session_replication_role = replica');
      await db.query(
        'DELETE FROM schedules WHERE class_id IN (SELECT id FROM classes WHERE org_id = ANY($1))',
        [orgs],
      );
      for (const t of [
        'schedule_changes',
        'leave_request_sessions',
        'leave_requests',
        'sessions',
        'students',
        'events',
        'classes',
        'courses',
        'subjects',
        'campuses',
      ]) {
        await db.query(`DELETE FROM ${t} WHERE org_id = ANY($1)`, [orgs]);
      }
      await db.query('DELETE FROM organizations WHERE id = ANY($1)', [orgs]);
      await db.query('COMMIT');
    } finally {
      db.release();
    }
    await pool.end();
  });

  let o: Awaited<ReturnType<typeof org>>;
  let bareEvent = '';
  beforeAll(async () => {
    o = await org();
    for (const d of ['2030-01-07', '2030-01-14', '2030-01-21']) await o.session(d);
    const changed = await o.session('2030-01-28');
    await q(
      `INSERT INTO schedule_changes (org_id, session_id, change_type, substitute_teacher_id)
       VALUES ($1, $2, 'substitute', NULL)`,
      [o.orgId, changed],
    );
    const attended = await o.session('2030-02-04');
    const eventId = await one(
      `INSERT INTO events (org_id, event_type, title, event_date) VALUES ($1, 'session', 'x', '2030-02-04')`,
      [o.orgId],
    );
    await q('UPDATE events SET attendance_taken_at = now() WHERE id = $1', [eventId]);
    await q('UPDATE sessions SET event_id = $1 WHERE id = $2', [eventId, attended]);
    // 有 event 但沒點過名（課堂產生時就帶著 event 的情況）：不算有資料，照樣刪掉重產
    bareEvent = await one(
      `INSERT INTO events (org_id, event_type, title, event_date) VALUES ($1, 'session', 'x', '2030-01-21')`,
      [o.orgId],
    );
    await q(
      `UPDATE sessions SET event_id = $1 WHERE class_id = $2 AND session_date = '2030-01-21'`,
      [bareEvent, o.classId],
    );
  });

  it('dryRun：回同樣的預覽，但什麼都沒寫', async () => {
    const before = [await schedulesOf(o.classId), await sessionsOf(o.classId)];
    const r = await splitSchedule(pool, input(o, { dryRun: true }));
    expect(r).toMatchObject({ status: 'done', dryRun: true, removedCount: 1, createdCount: 2 });
    expect([await schedulesOf(o.classId), await sessionsOf(o.classId)]).toEqual(before);
  });

  it('別 org、分校範圍外 → not-found，什麼都沒寫', async () => {
    const other = await org();
    expect(await splitSchedule(pool, input({ ...o, orgId: other.orgId }))).toEqual({
      status: 'not-found',
    });
    expect(await splitSchedule(pool, input(o, { scope: [other.campusId] }))).toEqual({
      status: 'not-found',
    });
    expect((await schedulesOf(o.classId)).length).toBe(1);
  });

  it('生效日不晚於舊段起始日 → invalid-date', async () => {
    expect(await splitSchedule(pool, input(o, { fromDate: '2030-01-01' }))).toMatchObject({
      status: 'invalid-date',
      effectiveFrom: '2030-01-01',
    });
  });

  it('split：舊段止於 X−1、新段起於 X（相鄰兩段存得進去）；X 前後的課堂落在正確的時段', async () => {
    const r = await splitSchedule(pool, input(o));
    expect(r).toMatchObject({ status: 'done', dryRun: false, removedCount: 1, createdCount: 2 });
    if (r.status !== 'done') return;
    expect(r.kept.map((k) => [k.sessionDate, k.reasons])).toEqual([
      ['2030-01-28', ['schedule_change']],
      ['2030-02-04', ['attendance']],
    ]);

    expect(await schedulesOf(o.classId)).toEqual([
      expect.objectContaining({
        id: o.scheduleId,
        effective_from: '2030-01-01',
        effective_to: '2030-01-19',
      }),
      expect.objectContaining({
        id: r.newScheduleId,
        weekday: 3,
        effective_from: '2030-01-20',
        effective_to: null,
      }),
    ]);
    // 被刪課堂帶著的 event（沒點名）一起清掉，不留孤兒；點過名的那堂的 event 還在
    expect(await q('SELECT id FROM events WHERE id = $1', [bareEvent])).toEqual([]);
    expect(
      await q(
        `SELECT e.id FROM events e WHERE e.org_id = $1
           AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.event_id = e.id)`,
        [o.orgId],
      ),
    ).toEqual([]);
    expect((await sessionsOf(o.classId)).map((s) => [s.session_date, s.schedule_id])).toEqual([
      ['2030-01-07', o.scheduleId],
      ['2030-01-14', o.scheduleId],
      ['2030-01-23', r.newScheduleId],
      ['2030-01-28', o.scheduleId],
      ['2030-01-30', r.newScheduleId],
      ['2030-02-04', o.scheduleId],
    ]);
  });

  // 審核席二讀：每個保留理由各一堂，拿掉任何一個判斷都要紅。
  // **leave 最要緊**：刪了課堂，`leave_request_sessions` 會跟著 CASCADE 消失 —— 請假綁定不見，
  // 那張假就從「請這幾堂」變成整天的語意
  it('保留理由：停課（status）、綁了請假（leave）、被補課指向（makeup）的舊課堂都留著，綁定也在', async () => {
    const p = await org();
    const cancelled = await p.session('2030-01-21');
    await q(`UPDATE sessions SET status = 'cancelled' WHERE id = $1`, [cancelled]);

    const onLeave = await p.session('2030-01-28');
    const studentId = await one(
      `INSERT INTO students (org_id, name, grade) VALUES ($1, 'x', 'P5')`,
      [p.orgId],
    );
    const leaveId = await one(
      `INSERT INTO leave_requests (org_id, student_id, start_date, end_date, submitted_by, submitted_by_role)
       VALUES ($1, $2, '2030-01-28', '2030-01-28', (SELECT id FROM ba_user LIMIT 1), 'admin')`,
      [p.orgId, studentId],
    );
    await q(
      `INSERT INTO leave_request_sessions (leave_request_id, session_id, org_id) VALUES ($1, $2, $3)`,
      [leaveId, onLeave, p.orgId],
    );

    const madeUp = await p.session('2030-02-04');
    // 補課那堂不在舊時段上（schedule_id 是 null），只是指著 02-04
    await q(
      `INSERT INTO sessions (org_id, class_id, session_date, start_time, end_time, assignment_status, makeup_for_session_id)
       VALUES ($1, $2, '2030-02-09', '14:00', '15:00', 'unassigned', $3)`,
      [p.orgId, p.classId, madeUp],
    );

    const r = await splitSchedule(pool, input(p));
    expect(r).toMatchObject({ status: 'done', removedCount: 0, createdCount: 0 });
    if (r.status !== 'done') return;
    expect(r.kept.map((k) => [k.id, k.reasons])).toEqual([
      [cancelled, ['status']],
      [onLeave, ['leave']],
      [madeUp, ['makeup']],
    ]);
    const alive = await q<{ id: string }>(`SELECT id FROM sessions WHERE id = ANY($1::uuid[])`, [
      [cancelled, onLeave, madeUp],
    ]);
    expect(alive).toHaveLength(3);
    expect(
      await q(
        `SELECT 1 FROM leave_request_sessions WHERE leave_request_id = $1 AND session_id = $2`,
        [leaveId, onLeave],
      ),
    ).toHaveLength(1);
  });

  // 刪 event 的 `attendance_taken_at IS NULL` 在同一個交易裡看似多餘（判成可刪的課堂，它的 event 本來就沒點名），
  // 但 **events 沒被鎖**：分類之後、刪 event 之前，老師可能剛好按了點名。用第二條連線把那一刻做出來
  it('分類之後才點名的 event：刪 event 時重新判斷，點過名的不刪', async () => {
    const p = await org();
    const sessionId = await p.session('2030-01-21');
    const eventId = await one(
      `INSERT INTO events (org_id, event_type, title, event_date) VALUES ($1, 'session', 'x', '2030-01-21')`,
      [p.orgId],
    );
    await q('UPDATE sessions SET event_id = $1 WHERE id = $2', [eventId, sessionId]);

    const teacher = await pool.connect();
    try {
      await teacher.query('BEGIN');
      // 點名進行中：列鎖握著、還沒 COMMIT —— split 分類時讀到的是舊版（沒點名）
      await teacher.query('UPDATE events SET attendance_taken_at = now() WHERE id = $1', [eventId]);
      const split = splitSchedule(pool, input(p));
      // 等 split 卡在 DELETE events（等這把列鎖）再放手
      for (let i = 0; i < 100; i++) {
        const [w] = await q<{ n: string }>(
          `SELECT count(*) n FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND query LIKE 'DELETE FROM events%'`,
        );
        if (Number(w!.n) > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await teacher.query('COMMIT');
      const r = await split;
      expect(r).toMatchObject({ status: 'done', removedCount: 1 });
    } finally {
      teacher.release();
    }
    const [event] = await q<{ attendance_taken_at: Date | null }>(
      'SELECT attendance_taken_at FROM events WHERE id = $1',
      [eventId],
    );
    expect(event?.attendance_taken_at).not.toBeNull();
  });

  it('同班同星期同開始時間、區間重疊：排除約束擋下（直接寫入 23P01；split 回 overlap 且整筆回滾）', async () => {
    await expect(
      q(
        `INSERT INTO schedules (class_id, weekday, start_time, end_time, effective_from)
         VALUES ($1, 3, '10:00', '11:00', '2030-03-01')`,
        [o.classId],
      ),
    ).rejects.toMatchObject({ code: '23P01' });

    // 另一段週一 14:00，從 06-01 起改成週三 10:00 → 跟上一題切出來的週三段（01-20 起、不止）重疊
    const mon = await one(
      `INSERT INTO schedules (class_id, weekday, start_time, end_time, effective_from)
       VALUES ($1, 1, '14:00', '15:00', '2030-01-01')`,
      [o.classId],
    );
    const before = await schedulesOf(o.classId);
    expect(
      await splitSchedule(pool, input(o, { scheduleId: mon, fromDate: '2030-06-01' })),
    ).toEqual({ status: 'overlap' });
    expect(await schedulesOf(o.classId)).toEqual(before);
  });
});

/**
 * 路由對**真的** PostgREST：POST 時段的生效日預設（要 select 到 `start_date`）、split 路由交易外那句
 * `classes!inner(...)` 的嵌入與 org 篩選 —— select 字串錯了替身驗不出來。
 */
const URL = process.env['SUPABASE_URL'];
const KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const runRoute = URL && KEY && DB ? describe : describe.skip;

runRoute('時段生效日的路由對真 PostgREST（#1100 #22）', () => {
  const pool = new Pool({ connectionString: DB });
  let orgId = '';
  let classId = '';

  const one = async (sql: string, params: unknown[]) =>
    (await pool.query<{ id: string }>(`${sql} RETURNING id`, params)).rows[0]!.id;

  const call = async (method: string, path: string, body?: unknown) => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', createClient(URL!, KEY!));
      set('auth', { pool });
      set('orgId', orgId);
      set('userId', null);
      set('roles', ['admin']);
      set('permissions', ['*']);
      set('campusScope', null);
      await next();
    });
    app.route('/', classesRoute as unknown as Hono);
    const res = await app.request(path, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  beforeAll(async () => {
    orgId = await one('INSERT INTO organizations (name) VALUES ($1)', [`c22r-${randomUUID()}`]);
    const campusId = await one(`INSERT INTO campuses (org_id, name) VALUES ($1, 'x')`, [orgId]);
    const subjectId = await one(`INSERT INTO subjects (org_id, name) VALUES ($1, 'x')`, [orgId]);
    const courseId = await one(
      `INSERT INTO courses (org_id, campus_id, subject_id, name) VALUES ($1, $2, $3, 'x')`,
      [orgId, campusId, subjectId],
    );
    classId = await one(
      `INSERT INTO classes (org_id, campus_id, course_id, name, start_date)
       VALUES ($1, $2, $3, 'x', '2030-01-01')`,
      [orgId, campusId, courseId],
    );
  });

  afterAll(async () => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SET LOCAL session_replication_role = replica');
      await db.query(
        'DELETE FROM schedules WHERE class_id IN (SELECT id FROM classes WHERE org_id = $1)',
        [orgId],
      );
      for (const t of ['audit_logs', 'sessions', 'classes', 'courses', 'subjects', 'campuses']) {
        await db.query(`DELETE FROM ${t} WHERE org_id = $1`, [orgId]);
      }
      await db.query('DELETE FROM organizations WHERE id = $1', [orgId]);
      await db.query('COMMIT');
    } finally {
      db.release();
    }
    await pool.end();
  });

  let scheduleId = '';

  it('POST 沒帶生效日 → 班級開課日；帶了就照帶的', async () => {
    const dflt = await call('POST', `/${classId}/schedules`, {
      weekday: 1,
      startTime: '10:00',
      endTime: '11:00',
    });
    expect(dflt.status).toBe(201);
    expect(dflt.body.data).toMatchObject({ effectiveFrom: '2030-01-01', effectiveTo: null });
    scheduleId = dflt.body.data.id;

    const given = await call('POST', `/${classId}/schedules`, {
      weekday: 2,
      startTime: '10:00',
      endTime: '11:00',
      effectiveFrom: '2030-02-01',
    });
    expect(given.status).toBe(201);
    expect(given.body.data.effectiveFrom).toBe('2030-02-01');
  });

  it('split：生效日早於今天 → 400；別 org 的班 → 404；正常 → 200 回新時段', async () => {
    const slot = {
      weekday: 3,
      startTime: '10:00',
      endTime: '11:00',
      teacherId: null,
      classroomId: null,
    };
    const past = await call('POST', `/${classId}/schedules/${scheduleId}/split`, {
      ...slot,
      fromDate: '2020-01-01',
    });
    expect(past).toMatchObject({ status: 400, body: { code: 'INVALID_DATE' } });

    const foreign = await call('POST', `/${randomUUID()}/schedules/${scheduleId}/split`, {
      ...slot,
      fromDate: '2030-03-01',
    });
    expect(foreign.status).toBe(404);

    const preview = await call('POST', `/${classId}/schedules/${scheduleId}/split`, {
      ...slot,
      fromDate: '2030-03-01',
      dryRun: true,
    });
    expect(preview).toMatchObject({
      status: 200,
      body: { data: { dryRun: true, newSchedule: null } },
    });

    const ok = await call('POST', `/${classId}/schedules/${scheduleId}/split`, {
      ...slot,
      fromDate: '2030-03-01',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.newSchedule).toMatchObject({
      weekday: 3,
      effectiveFrom: '2030-03-01',
      effectiveTo: null,
    });

    const detail = await call('GET', `/${classId}`);
    expect(
      detail.body.data.schedules
        .filter((s: { weekday: number }) => s.weekday !== 2)
        .map((s: { weekday: number; effectiveFrom: string; effectiveTo: string | null }) => [
          s.weekday,
          s.effectiveFrom,
          s.effectiveTo,
        ])
        .sort(),
    ).toEqual([
      [1, '2030-01-01', '2030-02-28'],
      [3, '2030-03-01', null],
    ]);
  });
});
