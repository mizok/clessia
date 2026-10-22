import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { academicYearOf } from '../lib/grade-promotion';
import { enqueueGradePromotionReminders } from '../lib/staff-digests';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

/**
 * #1820 學年升級前提醒對真 DB：兩句 SQL 的形狀（`notification_kind` 新值、鍵、`grade_promotions` 判斷）。
 * 自己建 org，管理員**借 seed 既有的使用者**（只建 staff 列，不寫 user_roles／ba_user，c2），跑完刪掉。
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

run('學年升級前提醒對真 DB（#1820）', () => {
  const pool = new Pool({ connectionString: DB });
  const today = getCurrentTaipeiDateString();
  const upgradeDate = addDays(today, 3);
  let orgId = '';
  let userId = '';

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const enqueue = async () => {
    const db = await pool.connect();
    try {
      return await enqueueGradePromotionReminders(db, today, [orgId]);
    } finally {
      db.release();
    }
  };
  const reminders = () =>
    q<{ user_id: string; dedupe_key: string }>(
      `SELECT user_id, dedupe_key FROM notifications
       WHERE org_id = $1 AND kind = 'grade_promotion_reminder'`,
      [orgId],
    );

  beforeAll(async () => {
    [{ id: orgId }] = await q<{ id: string }>(
      `INSERT INTO organizations (name, grade_promotion_month_day, grade_promotion_reminder_days)
       VALUES ($1, $2, 7) RETURNING id`,
      [`c1820-remind-${Date.now()}`, upgradeDate.slice(5)],
    );
    // 能代表全機構按升級的管理員：`*` 或 manage_students＋all_campuses
    const [admin] = await q<{ user_id: string }>(
      `SELECT user_id FROM user_roles WHERE role = 'admin'
         AND (permissions ? '*' OR (permissions ? 'manage_students' AND permissions ? 'all_campuses'))
       ORDER BY user_id LIMIT 1`,
    );
    userId = admin!.user_id;
    await q(
      `INSERT INTO staff (org_id, user_id, status, display_name) VALUES ($1, $2, 'active', '測試管理員')`,
      [orgId, userId],
    );
  });

  afterAll(async () => {
    if (orgId) {
      for (const t of ['notifications', 'grade_promotions', 'staff']) {
        await pool.query(`DELETE FROM ${t} WHERE org_id = $1`, [orgId]);
      }
      await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    }
    await pool.end();
  });

  it('提醒窗內寫一則，鍵帶升級日；同一天再跑不重複', async () => {
    expect(await enqueue()).toBe(1);
    expect(await reminders()).toEqual([
      { user_id: userId, dedupe_key: `grade_promotion_reminder:${orgId}:${upgradeDate}` },
    ]);
    expect(await enqueue()).toBe(0);
  });

  it('那一學年已經升過（未復原）→ 不提醒；復原了 → 照提醒', async () => {
    await q(`DELETE FROM notifications WHERE org_id = $1`, [orgId]);
    const [{ id }] = await q<{ id: string }>(
      `INSERT INTO grade_promotions (org_id, academic_year) VALUES ($1, $2) RETURNING id`,
      [orgId, academicYearOf(upgradeDate)],
    );
    expect(await enqueue()).toBe(0);

    await q(`UPDATE grade_promotions SET reverted_at = now() WHERE id = $1`, [id]);
    expect(await enqueue()).toBe(1);
  });

  it('天數 0＝不提醒', async () => {
    await q(`DELETE FROM notifications WHERE org_id = $1`, [orgId]);
    await q(`UPDATE organizations SET grade_promotion_reminder_days = 0 WHERE id = $1`, [orgId]);
    expect(await enqueue()).toBe(0);
  });
});
