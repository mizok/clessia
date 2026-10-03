-- ============================================================
-- 補習班帳戶資訊（#1073）：機構預設＋分校覆寫
--
-- specs/parent/payments.md「待付款」要列補習班帳戶資訊，而原本沒有任何欄位存它，
-- 家長頁只寫「請洽行政人員」。形狀照 campuses.attendance_mode（#1112）：
--
-- - organizations.payment_info：機構預設。NULL = 還沒設定（家長頁退回「請洽行政人員」）
-- - campuses.payment_info：分校覆寫。NULL = 沿用機構預設
--
-- 多行自由文字，不結構化（銀行代碼／帳號／戶名）—— 補習班的付款說明形形色色
-- （多個帳戶、LINE Pay、現金時段），使用者裁「一個多行欄位」。
-- 推算在 API 的 `lib/payment-info.ts`（分校值 → 機構預設）。
--
-- 純加欄（ADD COLUMN … NULL），「套完才部署」或「部署完才套」都安全：
-- 舊程式碼不讀這兩欄；新程式碼讀到 NULL 就退回下一層。
-- ============================================================
ALTER TABLE public.organizations
  ADD COLUMN payment_info text NULL;

COMMENT ON COLUMN public.organizations.payment_info IS
  '補習班帳戶資訊（多行文字，給家長付款用）；NULL = 未設定（#1073）';

ALTER TABLE public.campuses
  ADD COLUMN payment_info text NULL;

COMMENT ON COLUMN public.campuses.payment_info IS
  '分校帳戶資訊；NULL = 沿用 organizations.payment_info（#1073）';
