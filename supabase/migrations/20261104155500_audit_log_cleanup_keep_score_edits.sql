-- #1974（併 #1973）：成績修改紀錄不跟著 audit_logs 的 90 天清除走。
--
-- #1931 起考試完成後仍可改成績，每次修改的「誰、何時、舊值→新值」寫在 audit_logs
-- （action = `academy_exam.scores.upsert／delete`、`school_exam.scores.upsert／delete`，
-- 寫入點只有 apps/api/src/lib/exam-scores-write.ts）。原排程（20260223140000）每天無條件刪
-- 90 天前的 audit_logs，一學期之後這些修改歷史就沒了。
--
-- 計畫席 11-04 裁 (a)：改排程條件，不另開表。成績修改保留 2 年（「至少一學年」，跟
-- cleanup-schedule-changes 的 2 年一致），其餘照舊 90 天。
-- `action LIKE '%.scores.%'` 只對到上面四種（其他 action 沒有 `.scores.`）；新增成績類稽核時沿用這個命名。
--
-- 重建排程的寫法照原 migration（先 unschedule 再 schedule，冪等）。

SELECT cron.unschedule('cleanup-audit-logs') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-audit-logs'
);

-- 每天凌晨 02:00 (UTC+8 = 18:00 UTC)
SELECT cron.schedule(
  'cleanup-audit-logs',
  '0 18 * * *',
  $$ DELETE FROM public.audit_logs
     WHERE created_at < NOW() - CASE WHEN action LIKE '%.scores.%'
                                     THEN INTERVAL '2 years'
                                     ELSE INTERVAL '90 days' END $$
);
