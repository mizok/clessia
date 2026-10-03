-- ============================================================
-- 推薦加選的人工標記（#1118）：classes.is_recommended
--
-- 規格要家長目錄「標記為推薦加選的優先顯示」並畫推薦標籤（specs/parent/add-course.md、
-- dashboard.md、trial.md），而 schema 沒有任何推薦的資料來源。使用者裁：人工標記。
--
-- **單位是班不是課程**：目錄是一列一班（/api/me/catalog），卡片是「課程名＋開課班名」；
-- 掛在課程上的話，同課程底下已額滿／年級不合的班也會被一起推。
--
-- 純加欄（NOT NULL DEFAULT false），照預設「套完才部署」：新的 catalog select 會讀這欄。
-- ============================================================
ALTER TABLE public.classes
  ADD COLUMN is_recommended boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.classes.is_recommended IS
  '家長端「推薦加選」的人工標記（#1118）：目錄推薦優先排序、卡片畫推薦標籤';
