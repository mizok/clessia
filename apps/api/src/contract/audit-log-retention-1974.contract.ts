import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * **#1974：成績修改紀錄不跟著 audit_logs 的 90 天清除走**，對真的本機 Postgres 跑。
 *
 * 清除是 pg_cron 的 `cleanup-audit-logs`（20260223140000，每天刪 90 天前的 audit_logs，不分種類）。
 * #1931 起成績的「舊值→新值」寫在 `academy_exam.scores.*`／`school_exam.scores.*`，90 天後就沒了。
 *
 * 這裡**直接執行排程登記的那句 SQL**（`cron.job.command`），斷言哪些列留下 —— 驗的是真的會跑的東西，
 * 不是另外抄一份條件。整段包在交易裡、最後 ROLLBACK：那句 DELETE 不分 org，不能真的刪掉別人的列。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

run('#1974 audit_logs 清除排程保留成績修改紀錄', () => {
  const pool = new Pool({ connectionString: DB });
  afterAll(() => pool.end());

  it('成績修改 100 天前的留著、超過 2 年的清掉；其他種類照舊 90 天', async () => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const [{ command }] = (
        await db.query<{ command: string }>(
          "SELECT command FROM cron.job WHERE jobname = 'cleanup-audit-logs'",
        )
      ).rows as [{ command: string }];

      const org = randomUUID();
      const row = (key: string, resource: string, action: string, daysAgo: number) =>
        db.query(
          `INSERT INTO public.audit_logs (org_id, resource_type, resource_id, action, created_at)
           VALUES ($1, $2, $3, $4, now() - make_interval(days => $5))`,
          [org, resource, key, action, daysAgo],
        );
      await row('score-100', 'academy_exam', 'academy_exam.scores.upsert', 100);
      await row('school-score-300', 'school_exam', 'school_exam.scores.delete', 300);
      await row('score-800', 'academy_exam', 'academy_exam.scores.upsert', 800);
      await row('exam-close-100', 'academy_exam', 'close', 100);
      await row('class-100', 'class', 'update', 100);
      await row('class-10', 'class', 'update', 10);

      await db.query(command);

      const left = (
        await db.query<{ resource_id: string }>(
          'SELECT resource_id FROM public.audit_logs WHERE org_id = $1 ORDER BY resource_id',
          [org],
        )
      ).rows.map((r) => r.resource_id);
      expect(left).toEqual(['class-10', 'school-score-300', 'score-100']);
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  });
});
