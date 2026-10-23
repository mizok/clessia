import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { notifyScheduleChange } from '../lib/notify-schedule';

/**
 * #1100 #49：課務異動 → 家長，對**真的** PostgREST 跑（巢狀 embed `students → parent_student_relations
 * → parents`、`.or(effective_to.is.null,…)` 替身都不會驗），收件人要跟「同一題用 SQL 獨立算一次」逐人相同。
 * 用一顆新的 batch id 寫進 seed 的 org，測完把這顆鍵的通知（老師、管理員、家長）全部刪掉。
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

run('課務異動 → 家長（#1100 #49）對真 DB', () => {
  const pool = new Pool({ connectionString: DB });
  const supabase = createClient(URL!, KEY!, { auth: { persistSession: false } });
  const batch = randomUUID();
  afterAll(async () => {
    await pool.query('DELETE FROM notifications WHERE dedupe_key LIKE $1', [`%${batch}%`]);
    await pool.end();
  });

  it('收件人＝那堂當天在籍（非作廢）學生的 active 家長，跟 SQL 逐人相同', async () => {
    // 挑一堂「有在籍學生且學生有家長帳號」的課
    const { rows: picked } = await pool.query<{ id: string; org_id: string }>(
      `SELECT s.id, s.org_id::text
       FROM sessions s
       JOIN enrollments e ON e.class_id = s.class_id AND e.org_id = s.org_id AND e.status <> 'void'
         AND e.effective_from <= s.session_date
         AND (e.effective_to IS NULL OR e.effective_to >= s.session_date)
       JOIN parent_student_relations r ON r.student_id = e.student_id
       JOIN parents p ON p.id = r.parent_id AND p.org_id = s.org_id AND p.status = 'active'
       GROUP BY s.id, s.org_id
       HAVING count(DISTINCT p.user_id) >= 2
       ORDER BY s.id LIMIT 1`,
    );
    expect(picked.length).toBe(1); // seed 沒有就什麼都沒驗到
    const { id: sessionId, org_id: orgId } = picked[0]!;

    const { rows: expected } = await pool.query<{ user_id: string }>(
      `SELECT DISTINCT p.user_id
       FROM sessions s
       JOIN enrollments e ON e.class_id = s.class_id AND e.org_id = s.org_id AND e.status <> 'void'
         AND e.effective_from <= s.session_date
         AND (e.effective_to IS NULL OR e.effective_to >= s.session_date)
       JOIN parent_student_relations r ON r.student_id = e.student_id
       JOIN parents p ON p.id = r.parent_id AND p.org_id = s.org_id AND p.status = 'active'
       WHERE s.id = $1 AND p.user_id IS NOT NULL
       ORDER BY 1`,
      [sessionId],
    );

    await notifyScheduleChange(supabase, {
      orgId,
      actorUserId: 'nobody',
      rows: [{ session_id: sessionId, change_type: 'cancellation', batch_id: batch }],
    });

    const { rows: got } = await pool.query<{ user_id: string; payload: { sessionIds: string[] } }>(
      `SELECT user_id, payload FROM notifications
       WHERE role = 'parent' AND kind = 'schedule_change' AND dedupe_key LIKE $1
       ORDER BY user_id`,
      [`schedule_change:parent:${batch}:%`],
    );
    expect(got.map((r) => r.user_id)).toEqual(expected.map((r) => r.user_id));
    expect(got.every((r) => r.payload.sessionIds.includes(sessionId))).toBe(true);
  });
});
