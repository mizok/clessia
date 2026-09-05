-- ============================================================
-- academy_exams：新增及格線欄位（#295 窗口裁決，2026-09-05 使用者批准動工）
-- ============================================================
--
-- 只做 academy_exams，不做 school_exams：academy_exams 有 total_score 對照，
-- 加法優先（沿用既有「有分數的地方就有滿分」這條線）。school_exams 完全沒有
-- 總分欄位，pass_score 在那裡會變成唯一門檻、沒有比例退路，那是獨立的產品題，
-- 這一輪不做（見 apps/web/.../grades/score-threshold.util.ts 的說明）。
--
-- NULL = 未設，沿用「總分 × 60%」的既有退路（見 isFailingScore 的三層退路）。
ALTER TABLE public.academy_exams
  ADD COLUMN pass_score smallint;

-- 有值就要落在 [0, total_score] 之間 —— 0 是有效值（「這場不當人」），
-- 上界不能超過滿分，不然「及格線比滿分還高」這種打字錯誤會安靜地卡進資料庫。
ALTER TABLE public.academy_exams
  ADD CONSTRAINT academy_exams_pass_score_range
  CHECK (pass_score IS NULL OR (pass_score >= 0 AND pass_score <= total_score));
