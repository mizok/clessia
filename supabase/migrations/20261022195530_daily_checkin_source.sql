-- ============================================================
-- 到班紀錄的來源（#1100 #52；計畫席 10-23 裁 A）
--
-- 名單要分「16:12 掃碼到」與「17:40 到班（老師標記）」（specs/teacher/schedule.md）。
-- 用 checked_in_by 的角色反推分不出來：行政帳號既會在「掃碼站」掃碼、也會在儀表板手動標記，
-- 兩條都寫 daily_checkins。所以由寫入端明確記下來源：
-- - scan：掃碼（機台、行政的掃碼站）
-- - manual：人工標記（老師名單的「他到了」、行政儀表板）
-- - NULL：這欄出現之前的既有紀錄，不 backfill（名單上只寫時間，不猜）。
--
-- 純加型別＋加可空欄，「套完才部署」或「部署完才套」都安全：舊程式碼不讀也不寫這欄
-- （upsert 沒帶就是 NULL）。寫入端與顯示是另一支 PR，等這支套上正式之後才合（deploying.md）。
-- ============================================================
CREATE TYPE public.daily_checkin_source AS ENUM ('scan', 'manual');

ALTER TABLE public.daily_checkins
  ADD COLUMN source public.daily_checkin_source NULL;
