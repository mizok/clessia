-- ============================================================
-- 報名審核時效與試聽跟進提醒（#1821，設計稿 kb/wiki/specs/admin/enrollment/application-reminders.md）
--
-- 1. 通知種類（管理員，manage_students、分校範圍同 application_received；不推播、只進通知中心）：
--      application_overdue  申請送出 N 天還沒處理
--      trial_followup       試聽日之後 N 天還沒報名
--    ADD VALUE 不能跟「使用這個新值」放在同一個交易（20260906083827）—— 這支只加值、不用它。
-- 2. 機構設定兩欄（A6「報名流程」段）：0＝關掉這種提醒（裁定 C），1–30 天。
--
-- 純加列舉值與有預設值的欄位，「套完才部署」或「部署完才套」都安全：舊程式碼不讀也不寫它們。
-- ============================================================
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'application_overdue';
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'trial_followup';

ALTER TABLE public.organizations
  ADD COLUMN application_review_days smallint NOT NULL DEFAULT 3
    CONSTRAINT organizations_application_review_days_range
    CHECK (application_review_days BETWEEN 0 AND 30),
  ADD COLUMN trial_followup_days smallint NOT NULL DEFAULT 1
    CONSTRAINT organizations_trial_followup_days_range
    CHECK (trial_followup_days BETWEEN 0 AND 30);
