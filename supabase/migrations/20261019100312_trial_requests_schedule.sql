-- ============================================================
-- 試聽排定的日期與時間（#1727，設計稿 kb/wiki/specs/parent/applications.md Q2 (b)）
--
-- status = 'scheduled' 之前只有狀態、沒有「哪一天」。管理端填日期、家長端顯示另開單；這支只加欄位。
-- 地點不另外加欄位：用課程所在的分校。
--
-- 全部 nullable（待處理的申請、舊資料都沒有）。CHECK（計畫席 10-19）：
--   有開始時間就要有日期；有結束時間就要有開始時間，而且結束晚於開始。
-- 純加欄位＋只約束新欄位的 CHECK（既有列三欄都是 null，必過），兩種部署順序都安全。不做 backfill。
-- ============================================================
ALTER TABLE public.trial_requests
  ADD COLUMN IF NOT EXISTS scheduled_date date,
  ADD COLUMN IF NOT EXISTS scheduled_start_time time,
  ADD COLUMN IF NOT EXISTS scheduled_end_time time;

ALTER TABLE public.trial_requests
  ADD CONSTRAINT trial_requests_schedule_check CHECK (
    (scheduled_start_time IS NULL OR scheduled_date IS NOT NULL)
    AND (
      scheduled_end_time IS NULL
      OR (scheduled_start_time IS NOT NULL AND scheduled_end_time > scheduled_start_time)
    )
  );

COMMENT ON COLUMN public.trial_requests.scheduled_date IS '排定的試聽日期（#1727）；null＝還沒排';
