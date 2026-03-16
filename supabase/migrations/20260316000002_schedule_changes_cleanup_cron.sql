-- 每天凌晨 02:30 (UTC+8 = 18:30 UTC) 自動刪除 2 年前的課堂歷史紀錄
-- 保留 2 年：涵蓋學生在補習班的完整學習週期，供查帳與申訴用途

SELECT cron.unschedule('cleanup-schedule-changes') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-schedule-changes'
);

SELECT cron.schedule(
  'cleanup-schedule-changes',
  '30 18 * * *',
  $$ DELETE FROM public.schedule_changes WHERE created_at < NOW() - INTERVAL '2 years' $$
);
