import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServiceClientFromEnv } from '../lib/supabase';
import { loadDailyAttendance } from '../lib/today-attendance';

/**
 * **日到班「今天誰請假」在應到人數很多時也對**（#1928）。
 *
 * 原本把今天全部應到學生的 id 塞進 `.in('student_id', …)`：幾百人就 414，而錯誤沒檢查 →
 * 請假的學生顯示成「該到沒到」。改成撈 org 當天有效的假、只留應到名單裡的人。
 *
 * 自建一個 org：一個班今天有課、900 人在籍（刻意低於 max_rows 1000 —— 這支只守請假那一段），第 850 人請假；
 * 另一個班今天沒課，那班的學生也請了假（不在應到名單，不能列進來）。測完整個 org 刪掉。
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

const STUDENTS = 900;
const LEAVER = 850;
const DATE = '2026-06-01';

run('日到班：900 人應到時的請假（#1928）', () => {
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(sql, values))[0]!.id;
  let orgId = '';
  let todayClass = '';
  let leaverId = '';

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    orgId = await one(
      "insert into organizations (name) values ('#1928 契約：日到班請假') returning id",
      [],
    );
    const campus = await one(
      "insert into campuses (org_id, name) values ($1, '總校') returning id",
      [orgId],
    );
    const subject = await one(
      "insert into subjects (org_id, name) values ($1, '數學') returning id",
      [orgId],
    );
    const course = await one(
      "insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, '數學', $3) returning id",
      [orgId, campus, subject],
    );
    todayClass = await one(
      "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '今天有課') returning id",
      [orgId, campus, course],
    );
    const otherClass = await one(
      "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '今天沒課') returning id",
      [orgId, campus, course],
    );
    await q(
      `with s as (
         insert into students (org_id, name, grade)
         select $1, '生' || lpad(g::text, 4, '0'), 'J1' from generate_series(1, $2::int) g
         returning id
       )
       insert into enrollments (org_id, class_id, student_id, status, effective_from)
       select $1, $3, s.id, 'active', '2026-01-01' from s`,
      [orgId, STUDENTS, todayClass],
    );
    const outsider = await one(
      "insert into students (org_id, name, grade) values ($1, '沒課的人', 'J1') returning id",
      [orgId],
    );
    await q(
      "insert into enrollments (org_id, class_id, student_id, status, effective_from) values ($1, $2, $3, 'active', '2026-01-01')",
      [orgId, otherClass, outsider],
    );
    leaverId = await one('select id from students where org_id = $1 and name = $2', [
      orgId,
      `生${String(LEAVER).padStart(4, '0')}`,
    ]);
    for (const studentId of [leaverId, outsider]) {
      await q(
        `insert into leave_requests (org_id, student_id, start_date, end_date, submitted_by, submitted_by_role)
         values ($1, $2, $3, $3, $4, 'parent')`,
        [orgId, studentId, DATE, admin!.user_id],
      );
    }
  }, 120_000);

  afterAll(async () => {
    if (!orgId) return;
    for (const t of [
      'leave_requests',
      'enrollments',
      'students',
      'classes',
      'courses',
      'subjects',
      'campuses',
    ])
      await q(`delete from ${t} where org_id = $1`, [orgId]);
    await q('delete from organizations where id = $1', [orgId]);
  }, 120_000);

  it('900 人應到：請假的是第 850 人那一位（沒課的那位不算）', async () => {
    const supabase = createServiceClientFromEnv({
      SUPABASE_URL: URL!,
      SUPABASE_SECRET_KEY: KEY!,
    } as never);
    const res = await loadDailyAttendance(supabase as never, orgId, DATE, [
      {
        classId: todayClass,
        className: '今天有課',
        startTime: '16:00',
        campusId: null,
        campusName: null,
        status: 'scheduled',
      },
    ]);
    expect(res.expected).toHaveLength(STUDENTS);
    expect(res.onLeave.map((l) => l.studentId)).toEqual([leaverId]);
  });
});
