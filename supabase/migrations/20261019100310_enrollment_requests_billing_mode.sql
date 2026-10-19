-- ============================================================
-- 家長加選時選的繳費週期（#1727，設計稿 kb/wiki/specs/parent/applications.md Q1 (b)）
--
-- 直接用既有的 public.billing_mode（monthly／period／session_pack），**不加 CHECK 限制成月繳／期繳**
-- （計畫席 10-19）：這個班允許哪些方式由 API 對照班級設定驗證，不寫死在 schema；A6 只畫月繳／期繳，前端照畫。
--
-- nullable：舊資料、管理端與公開表單建的申請沒有這個值（行政核准時再定）。
-- 純加欄位，「套完才部署」或「部署完才套」都安全：舊程式碼不讀不寫它。不做 backfill。
-- ============================================================
ALTER TABLE public.enrollment_requests
  ADD COLUMN IF NOT EXISTS billing_mode public.billing_mode;

COMMENT ON COLUMN public.enrollment_requests.billing_mode IS
  '家長送出時選的繳費週期（#1727）；null＝沒選，行政核准時決定';
