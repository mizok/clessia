-- #1637／#1665（使用者 2026-10-16 15:04 裁定 Q2／Q5／Q6，15:25 裁定 Q5′）
-- 只加欄位（帶預設值）與排程，不改既有資料的值 —— 不是 backfill。

-- Q5：班級是否出現在公開的報名／試聽表單（只管匿名公開目錄，家長端不受影響）
-- ADD COLUMN … NOT NULL DEFAULT <常數> 在 Postgres 11+ 只改目錄、不重寫表。
ALTER TABLE public.classes
  ADD COLUMN is_public_enrollment boolean NOT NULL DEFAULT true;  -- Q5′：預設開放

-- Q6：對外顯示用的暱稱（所有 staff 都能設）；沒設就不對外顯示，絕不退回 display_name
ALTER TABLE public.staff
  ADD COLUMN nickname text
  CONSTRAINT staff_nickname_len CHECK (nickname IS NULL OR char_length(btrim(nickname)) BETWEEN 1 AND 20);

-- Q2＋Q3：公開申請保存 6 個月，不分狀態（含已轉入）；public_application_targets 是 ON DELETE CASCADE。
-- 稽核 resource_name 含姓名，但 audit_logs 有 90 天清除（20260223140000），早於 6 個月；
-- 若稽核保存期限改到超過 6 個月，這裡要補去識別化。
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule('purge-public-applications') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'purge-public-applications'
);
SELECT cron.schedule(
  'purge-public-applications',
  '30 18 * * *',  -- UTC 18:30 = 台北 02:30，錯開稽核清除的 18:00
  $$ DELETE FROM public.public_applications WHERE created_at < NOW() - INTERVAL '6 months' $$
);
