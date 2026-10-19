import { createClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadLeaveStreaks, notifyLeaveStreaks } from '../lib/leave-streak';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';
import leaveStreaksRoute from '../routes/leave-streaks';

/**
 * #1732 連續請假偵測對真 DB：替身不解析 select，`events!inner` 上的日期條件、`classes!inner`、
 * 餐費的 `invoice_items(period_month)` embed 寫錯，spec 照樣綠、上線 400（#1423 同型）。
 *
 * 自己建 org（一個分校、兩個班、三位學生），跑完刪掉。管理員**借 seed 既有的 `*` 管理員**，
 * 只在自己的 org 建 staff 列 —— 不寫 user_roles／ba_user（c2）。
 */

const DB = process.env['DATABASE_URL'];
const URL = process.env['SUPABASE_URL'];
const KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
if ((!DB || !URL || !KEY) && process.env['CONTRACT_REQUIRED']) {
  throw new Error(
    '[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL／SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY',
  );
}
const run = DB && URL && KEY ? describe : describe.skip;

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

run('連續請假偵測對真 DB（#1732）', () => {
  const pool = new Pool({ connectionString: DB });
  const supabase = createClient(URL!, KEY!, { auth: { persistSession: false } });
  // 四週前的那個週一：在「近期」窗內，也不會碰到未來
  const t = getCurrentTaipeiDateString();
  const monday = addDays(t, -28 - ((new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7));
  const MON = monday;
  const TUE = addDays(monday, 1);
  const WED = addDays(monday, 2);
  const THU = addDays(monday, 3);
  const NEXT_MON = addDays(monday, 7);
  let orgId = '';
  let adminUserId = '';
  const st: Record<'a' | 'b' | 'c', string> = { a: '', b: '', c: '' };

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const one = async (sql: string, params: unknown[]) =>
    (await q<{ id: string }>(`${sql} RETURNING id`, params))[0]!.id;

  beforeAll(async () => {
    orgId = await one(`INSERT INTO organizations (name, leave_waiver_days) VALUES ($1, 3)`, [
      `c1732-streak-${Date.now()}`,
    ]);
    const campus = await one(`INSERT INTO campuses (org_id, name) VALUES ($1, '總校')`, [orgId]);
    const subject = await one(`INSERT INTO subjects (org_id, name) VALUES ($1, '數學')`, [orgId]);
    const course = await one(
      `INSERT INTO courses (org_id, campus_id, name, subject_id) VALUES ($1, $2, '課', $3)`,
      [orgId, campus, subject],
    );
    const klass = async (name: string, leaveDeducts: boolean) =>
      one(
        `INSERT INTO classes (org_id, campus_id, course_id, name, leave_deducts_session) VALUES ($1, $2, $3, $4, $5)`,
        [orgId, campus, course, name, leaveDeducts],
      );
    const math = await klass('國二數學', true);
    const eng = await klass('國二英文', false);

    const session = async (classId: string, date: string, status = 'scheduled') => {
      const event = await one(
        `INSERT INTO events (org_id, event_type, title, event_date, start_time, end_time, campus_id)
         VALUES ($1, 'session', '課', $2, '18:00', '20:00', $3)`,
        [orgId, date, campus],
      );
      await q(
        `INSERT INTO sessions (org_id, class_id, session_date, start_time, end_time, status, event_id, assignment_status)
         VALUES ($1, $2, $3, '18:00', '20:00', $4, $5, 'unassigned')`,
        [orgId, classId, date, status, event],
      );
      return event;
    };
    await session(math, MON);
    await session(math, TUE, 'cancelled'); // 停課：不是上課日，不中斷
    const wedEvent = await session(math, WED);
    await session(eng, THU);
    await session(math, NEXT_MON); // 沒請假：斷開

    adminUserId = (
      await q<{ user_id: string }>(
        `SELECT user_id FROM user_roles WHERE role = 'admin' AND permissions ? '*' ORDER BY user_id LIMIT 1`,
      )
    )[0]!.user_id;
    const staff = await one(
      `INSERT INTO staff (org_id, user_id, display_name, status) VALUES ($1, $2, '王主任', 'active')`,
      [orgId, adminUserId],
    );
    await q(`INSERT INTO staff_campuses (staff_id, campus_id) VALUES ($1, $2)`, [staff, campus]);

    for (const key of ['a', 'b', 'c'] as const) {
      st[key] = await one(`INSERT INTO students (org_id, name, grade) VALUES ($1, $2, 'J2')`, [
        orgId,
        `學生${key}`,
      ]);
      for (const classId of [math, eng]) {
        await q(
          `INSERT INTO enrollments (org_id, class_id, student_id, billing_mode, effective_from, status)
           VALUES ($1, $2, $3, 'session_pack', $4, 'active')`,
          [orgId, classId, st[key], addDays(MON, -30)],
        );
      }
      // 兩張相鄰的假：週一～週三、週四（裁定 2：接起來合併）
      for (const [from, to] of [
        [MON, WED],
        [THU, THU],
      ]) {
        await q(
          `INSERT INTO leave_requests (org_id, student_id, start_date, end_date, submitted_by, submitted_by_role)
           VALUES ($1, $2, $3, $4, $5, 'admin')`,
          [orgId, st[key], from, to, adminUserId],
        );
      }
    }
    // b：週三請了假還是來了（Q4）；c：週三打卡
    await q(
      `INSERT INTO attendance_records (org_id, event_id, student_id, status) VALUES ($1, $2, $3, 'present')`,
      [orgId, wedEvent, st.b],
    );
    await q(
      `INSERT INTO daily_checkins (org_id, student_id, checkin_date, campus_id) VALUES ($1, $2, $3, $4)`,
      [orgId, st.c, WED, campus],
    );
    // a 的餐：週一訂了收費、週三訂了不收費
    await q(
      `INSERT INTO meal_records (org_id, student_id, meal_date, ordered, chargeable, unit_price)
       VALUES ($1, $2, $3, true, true, 80), ($1, $2, $4, true, false, 80)`,
      [orgId, st.a, MON, WED],
    );
  }, 60_000);

  // students／classes 等的 org FK 不是 CASCADE：照 staff-digests.contract 的收法，關掉 FK 觸發逐表刪
  afterAll(async () => {
    if (orgId) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query('SET LOCAL session_replication_role = replica');
        await db.query(
          'DELETE FROM staff_campuses WHERE staff_id IN (SELECT id FROM staff WHERE org_id = $1)',
          [orgId],
        );
        for (const t of [
          'notifications',
          'leave_streak_reviews',
          'meal_records',
          'daily_checkins',
          'attendance_records',
          'leave_requests',
          'enrollments',
          'students',
          'staff',
          'sessions',
          'events',
          'classes',
          'courses',
          'subjects',
          'campuses',
          'audit_logs',
        ]) {
          await db.query(`DELETE FROM ${t} WHERE org_id = $1`, [orgId]);
        }
        await db.query('COMMIT');
      } finally {
        db.release();
      }
      await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    }
    await pool.end();
  });

  it('a：週一、週三、週四＝一段 3 天（停課跳過、相鄰假單合併、下週一斷開）；b、c 有來的那天斷開', async () => {
    const { byStudent, threshold } = await loadLeaveStreaks(
      supabase,
      orgId,
      [st.a, st.b, st.c],
      addDays(MON, -62),
      addDays(NEXT_MON, 62),
    );
    expect(threshold).toBe(3);
    expect(
      byStudent.get(st.a)?.map((s) => [s.firstDay, s.lastDay, s.days.map((d) => d.date)]),
    ).toEqual([[MON, THU, [MON, WED, THU]]]);
    expect(byStudent.has(st.b)).toBe(false);
    expect(byStudent.has(st.c)).toBe(false);
  });

  it('通知：a 發一則給分校的財務管理員，重跑不重複；b 不發', async () => {
    for (let i = 0; i < 2; i++) {
      await notifyLeaveStreaks(supabase, { orgId, studentId: st.a, from: THU, to: THU });
    }
    await notifyLeaveStreaks(supabase, { orgId, studentId: st.b, from: THU, to: THU });
    const rows = await q<{
      user_id: string;
      kind: string;
      dedupe_key: string;
      push_status: string;
    }>(`SELECT user_id, kind, dedupe_key, push_status FROM notifications WHERE org_id = $1`, [
      orgId,
    ]);
    expect(rows).toEqual([
      {
        user_id: adminUserId,
        kind: 'leave_streak',
        dedupe_key: `leave_streak:${st.a}:${MON}:${THU}`,
        push_status: 'skipped',
      },
    ]);
  });

  it('真路由：明細的 embed 打得通；標為已處理後帳單頁那支不再回這段，復原後回來', async () => {
    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', supabase);
      set('orgId', orgId);
      set('campusScope', null);
      set('userId', adminUserId);
      set('roles', ['admin']);
      await next();
    });
    app.route('/api/leave-streaks', leaveStreaksRoute);

    const detail = await app.request(`/api/leave-streaks/students/${st.a}`);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).toMatchObject({
      firstDay: MON,
      lastDay: THU,
      meals: [{ date: MON, unitPrice: 80, invoicedMonth: null }],
      review: null,
    });
    expect(body.data[0]!['enrollments']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          className: '國二數學',
          leaveDeductsSession: true,
          sessionCount: 2,
        }),
        expect.objectContaining({
          className: '國二英文',
          leaveDeductsSession: false,
          sessionCount: 1,
        }),
      ]),
    );

    const list = () => app.request(`/api/leave-streaks?studentIds=${st.a},${st.b}`);
    expect(((await (await list()).json()) as { data: unknown[] }).data).toHaveLength(1);

    const marked = await app.request(`/api/leave-streaks/students/${st.a}/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ firstDay: MON, lastDay: THU }),
    });
    expect(marked.status).toBe(201);
    const reviewId = ((await marked.json()) as { data: { id: string } }).data.id;
    expect(((await (await list()).json()) as { data: unknown[] }).data).toHaveLength(0);

    const undo = await app.request(`/api/leave-streaks/students/${st.a}/reviews/${reviewId}`, {
      method: 'DELETE',
    });
    expect(undo.status).toBe(204);
    expect(((await (await list()).json()) as { data: unknown[] }).data).toHaveLength(1);
  });
});
