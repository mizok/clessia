-- ============================================================
-- 待開單提醒的提前天數改成機構設定（#1305）：organizations.billing_reminder_days
--
-- #1293 的「待開單」（GET /api/billing-periods/upcoming-unbilled）原本用常數 14 天。使用者 10-04 裁：要可調。
-- 本 repo 沒有 org_settings 表 —— 機構設定都是 organizations 上的欄位（同 invoice_due_days），
-- 讀寫走 routes/org-settings.ts；屬財務設定（manage_finance）。
--
-- DEFAULT 14 ＝ 原本的常數，套上去行為不變。1–90 跟 API 的 zod 同一組數字。
-- 純加欄，「套完才部署」或「部署完才套」都安全：新程式碼讀不到就退回 14。
-- ============================================================
ALTER TABLE public.organizations
  ADD COLUMN billing_reminder_days smallint NOT NULL DEFAULT 14,
  ADD CONSTRAINT organizations_billing_reminder_days_check
    CHECK (billing_reminder_days BETWEEN 1 AND 90);
