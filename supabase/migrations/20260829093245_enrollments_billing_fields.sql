-- ============================================================
-- enrollments 接上計費：加四個欄位，換掉 payment_cycle
--
-- 業務規則見 kb/wiki/rules/billing-rules.md：
--   規則 1 —— 計費模式是**報名層級**的選擇，不是班級屬性（同一班可以同時有月繳生
--             與期繳生），所以欄位掛在 enrollments 上。
--   規則 2 —— 金額是「定價 + 人工覆寫」：fee_template 給定價，這裡的 agreed_amount
--             記真正談定的每月／每期金額，開帳時抄過去。改它只影響未來的帳單，
--             已開出的帳單不動（帳單自己存快照）。
-- ============================================================

ALTER TABLE public.enrollments
  -- nullable：既有報名沒有值，而且「還沒決定計費方式」是真實狀態，不該被迫填一個假的
  ADD COLUMN billing_mode public.billing_mode,
  -- ON DELETE RESTRICT：價目表被引用過就不能刪，否則報名會失去定價的來源
  ADD COLUMN fee_template_id uuid REFERENCES public.fee_templates(id) ON DELETE RESTRICT,
  -- 談定的每月／每期金額。與 fee_template 的定價分開存 —— 議價是常態不是例外
  ADD COLUMN agreed_amount numeric(10, 0),
  -- 自由文字。**刻意不是結構化的折扣代碼**：現實裡不存在折扣規則，只存在議價理由
  ADD COLUMN adjustment_note text,
  ADD CONSTRAINT enrollments_agreed_amount_check CHECK (agreed_amount IS NULL OR agreed_amount >= 0);

CREATE INDEX enrollments_fee_template_id_idx ON public.enrollments (fee_template_id);

-- ============================================================
-- payment_cycle → billing_mode 的資料搬遷
--
-- 舊 enum 只有 monthly / semester。semester（學期）對應到新制的 period（自訂期間）
-- —— 語意一樣「一段具名區間收一次」，只是新制不把區間長度寫死。
-- 沒有值的留 null（見上：那是真實狀態）。
-- ============================================================
UPDATE public.enrollments
   SET billing_mode = CASE payment_cycle
     WHEN 'monthly'  THEN 'monthly'::public.billing_mode
     WHEN 'semester' THEN 'period'::public.billing_mode
   END
 WHERE payment_cycle IS NOT NULL;

-- ============================================================
-- 換乾淨，不留雙軌
--
-- 兩個欄位並存的代價是每一個讀寫點都要決定「聽哪一個」，而那個決定會在不同檔案裡
-- 做出不同答案。正式站這張表目前是空的、本機 seed 可改，成本就是現在最低的時候。
-- ============================================================
ALTER TABLE public.enrollments DROP COLUMN payment_cycle;
DROP TYPE public.payment_cycle;
