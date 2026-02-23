-- 啟用 pg_cron extension（若已啟用則略過）
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 移除舊排程（冪等，避免重複建立）
SELECT cron.unschedule('cleanup-audit-logs') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-audit-logs'
);

-- 每天凌晨 02:00 (UTC+8 = 18:00 UTC) 自動刪除 90 天前的紀錄
SELECT cron.schedule(
  'cleanup-audit-logs',
  '0 18 * * *',
  $$ DELETE FROM public.audit_logs WHERE created_at < NOW() - INTERVAL '90 days' $$
);
