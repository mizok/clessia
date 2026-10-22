import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { enqueueApplicationReminders } from '../lib/application-reminders';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

/**
 * #1821 申請提醒對真 DB：第一句 SQL 的判準（日期門檻含邊界、只看 30 天內、候補不算、
 * 已經報名不跟進、公開表單的分校從目標來、發過不再發、天數 0＝關）。
 *
 * 自己建 org，每個情境一位學生（申請表有「同學生同班／同課只能有一張進行中」的唯一索引）；
 * 管理員**借 seed 既有的使用者**（只建 staff 列，不寫 user_roles／ba_user，c2），跑完刪掉。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

run('申請提醒對真 DB（#1821）', () => {
  const pool = new Pool({ connectionString: DB });
  const today = getCurrentTaipeiDateString();
  /** N 天前（台北）中午送出 */
  const sentAgo = (n: number) => `${addDays(today, -n)} 12:00:00+08`;
  let orgId = '';
  let userId = '';
  let campus = '';
  let course = '';
  let klass = '';
  const ids: Record<string, string> = {};

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const one = async (sql: string, params: unknown[]) =>
    (await q<{ id: string }>(`${sql} RETURNING id`, params))[0]!.id;
  const student = (name: string) =>
    one(`INSERT INTO students (org_id, name, grade) VALUES ($1, $2, 'J1')`, [orgId, name]);
  const enqueue = async () => {
    const db = await pool.connect();
    try {
      return await enqueueApplicationReminders(db, today, [orgId]);
    } finally {
      db.release();
    }
  };
  const keys = async () =>
    (
      await q<{ dedupe_key: string; kind: string }>(
        `SELECT dedupe_key, kind::text FROM notifications WHERE org_id = $1 ORDER BY dedupe_key`,
        [orgId],
      )
    ).map((r) => `${r.kind}|${r.dedupe_key}`);

  beforeAll(async () => {
    orgId = await one(
      `INSERT INTO organizations (name, application_review_days, trial_followup_days) VALUES ($1, 3, 2)`,
      [`c1821-remind-${Date.now()}`],
    );
    [{ user_id: userId }] = await q<{ user_id: string }>(
      `SELECT user_id FROM user_roles WHERE role = 'admin' AND permissions ? '*' ORDER BY user_id LIMIT 1`,
    );
    await q(
      `INSERT INTO staff (org_id, user_id, status, display_name) VALUES ($1, $2, 'active', '測試管理員')`,
      [orgId, userId],
    );
    campus = await one(`INSERT INTO campuses (org_id, name) VALUES ($1, '分校')`, [orgId]);
    const subject = await one(`INSERT INTO subjects (org_id, name) VALUES ($1, '數學')`, [orgId]);
    course = await one(
      `INSERT INTO courses (org_id, campus_id, name, subject_id) VALUES ($1, $2, '國二數學', $3)`,
      [orgId, campus, subject],
    );
    klass = await one(
      `INSERT INTO classes (org_id, campus_id, course_id, name) VALUES ($1, $2, $3, 'A 班')`,
      [orgId, campus, course],
    );

    const enrollReq = async (name: string, ago: number, status = 'pending') => {
      ids[name] = await one(
        `INSERT INTO enrollment_requests (org_id, student_id, class_id, requested_by, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orgId, await student(name), klass, userId, status, sentAgo(ago)],
      );
    };
    await enrollReq('報名4天', 4);
    await enrollReq('報名3天', 3); // 邊界：剛好滿 3 天
    await enrollReq('報名2天', 2);
    await enrollReq('報名30天', 30); // 回看邊界：還在
    await enrollReq('報名31天', 31); // 計畫席裁：超過 30 天不發
    await enrollReq('候補5天', 5, 'waitlist'); // 裁定 A：候補不算沒處理

    ids['試聽5天'] = await one(
      `INSERT INTO trial_requests (org_id, student_id, course_id, requested_by, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', $5)`,
      [orgId, await student('試聽5天'), course, userId, sentAgo(5)],
    );

    const publicApp = async (name: string, status: string, target: boolean) => {
      ids[name] = await one(
        `INSERT INTO public_applications (org_id, kind, status, parent_name, parent_phone, parent_relation,
           student_name, student_grade, student_school, consented_at, created_at)
         VALUES ($1, 'enrollment', $2, '家長', '0912345678', '母', $3, 'J1', '某國中', now(), $4)`,
        [orgId, status, name, sentAgo(5)],
      );
      if (target) {
        await q(
          `INSERT INTO public_application_targets (application_id, class_id) VALUES ($1, $2)`,
          [ids[name], klass],
        );
      }
    };
    await publicApp('公開新', 'new', true);
    await publicApp('公開已聯絡', 'contacted', true);
    await publicApp('公開沒目標', 'new', false); // 找不到分校 → 沒有人收

    const trial = async (name: string, daysAgo: number, followUp?: 'enrolled' | 'requested') => {
      const s = await student(name);
      ids[name] = await one(
        `INSERT INTO trial_requests (org_id, student_id, course_id, requested_by, status, scheduled_date, created_at)
         VALUES ($1, $2, $3, $4, 'completed', $5, $6)`,
        [orgId, s, course, userId, addDays(today, -daysAgo), sentAgo(daysAgo + 3)],
      );
      if (followUp === 'enrolled') {
        await q(
          `INSERT INTO enrollments (org_id, class_id, student_id, billing_mode, effective_from, status)
           VALUES ($1, $2, $3, 'monthly', $4, 'active')`,
          [orgId, klass, s, today],
        );
      } else if (followUp === 'requested') {
        await q(
          `INSERT INTO enrollment_requests (org_id, student_id, class_id, requested_by, status, created_at)
           VALUES ($1, $2, $3, $4, 'pending', now())`,
          [orgId, s, klass, userId],
        );
      }
    };
    await trial('試聽後2天', 2); // 邊界：剛好滿 2 天
    await trial('試聽後1天', 1);
    await trial('試聽後已報名', 5, 'enrolled');
    await trial('試聽後已申請', 5, 'requested');
    await trial('試聽31天前', 31);
  }, 60_000);

  afterAll(async () => {
    if (orgId) {
      for (const t of [
        'notifications',
        'enrollment_requests',
        'trial_requests',
        'public_applications',
        'enrollments',
        'classes',
        'courses',
        'subjects',
        'students',
        'staff',
        'campuses',
      ]) {
        await pool.query(`DELETE FROM ${t} WHERE org_id = $1`, [orgId]);
      }
      await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    }
    await pool.end();
  });

  it('只發該發的：門檻含邊界、30 天內、候補不算、已報名不跟進、找不到分校沒人收', async () => {
    expect(await enqueue()).toBe(6);
    expect(await keys()).toEqual(
      [
        `application_overdue|overdue:application:${ids['公開新']}`,
        `application_overdue|overdue:parent_request:enrollment:${ids['報名30天']}`,
        `application_overdue|overdue:parent_request:enrollment:${ids['報名3天']}`,
        `application_overdue|overdue:parent_request:enrollment:${ids['報名4天']}`,
        `application_overdue|overdue:parent_request:trial:${ids['試聽5天']}`,
        `trial_followup|trial_followup:parent_request:${ids['試聽後2天']}`,
      ].sort(),
    );
  });

  it('發過的不再發', async () => {
    expect(await enqueue()).toBe(0);
  });

  it('天數 0＝關', async () => {
    await q(`DELETE FROM notifications WHERE org_id = $1`, [orgId]);
    await q(
      `UPDATE organizations SET application_review_days = 0, trial_followup_days = 0 WHERE id = $1`,
      [orgId],
    );
    expect(await enqueue()).toBe(0);
  });
});
