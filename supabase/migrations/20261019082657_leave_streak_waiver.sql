-- ============================================================
-- 連續請假滿 N 個上課日可不收費：提醒行政（#1732，設計稿 kb/wiki/specs/admin/finance/leave-streak-waiver.md §6）
--
-- 系統只偵測、只提醒，不改帳單、堂數、餐費紀錄。這支只放三樣：
--   1. organizations.leave_waiver_days：門檻 N（機構設定，財務 key，預設 3）。
--      2–30：1 天就變成「每次請假都不收」，不是這條規定；30 是防手誤。跟 API 的 zod 同一組數字。
--   2. notification_kind 加 'leave_streak'：通知有 manage_finance 的管理員（不推播）。
--      ADD VALUE 不能跟「使用這個新值」放在同一個交易（20260906083827）—— 這支只加值、不用它。
--   3. leave_streak_reviews：「已處理」（使用者 10-17 裁 Q2）。一列 = 某位學生某一段被標為已處理；
--      之後那段被延長（起訖往外長）就不再被這列完整涵蓋 → 重新出現。
--      授權只在 Hono middleware（c1）；RLS 開著、沒有 policy ＝ fail-closed 後盾（同其他業務表）。
--      reviewed_by 只是**參照** ba_user（不寫它，c2）。**可以是 NULL、ON DELETE SET NULL**（計畫席 10-19）：
--      RESTRICT 會讓「標過一次已處理」的帳號之後走 Better Auth 刪不掉；誰標的另有稽核紀錄。
--
-- 純加欄、加值、加表，沒有 backfill、不動既有欄位。**但它是 schema 類、要先套完才能部署**：
-- 同一支 PR 的 routes/org-settings.ts `SELECT_FIELDS` 讀 leave_waiver_days，欄位不存在時
-- GET／PUT /api/org/settings 直接報錯（kb/wiki/architecture/deploying.md，#1307 的教訓）。
-- CI 的 migrate→deploy 順序天然滿足；不要手動先部署 api。
-- ============================================================
ALTER TABLE public.organizations
  ADD COLUMN leave_waiver_days smallint NOT NULL DEFAULT 3,
  ADD CONSTRAINT organizations_leave_waiver_days_check
    CHECK (leave_waiver_days BETWEEN 2 AND 30);

ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'leave_streak';

CREATE TABLE public.leave_streak_reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  first_day   date NOT NULL,
  last_day    date NOT NULL,
  reviewed_by text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_streak_reviews_days_check CHECK (first_day <= last_day),
  CONSTRAINT leave_streak_reviews_student_days_key UNIQUE (student_id, first_day, last_day)
);

CREATE INDEX leave_streak_reviews_student_idx
  ON public.leave_streak_reviews (student_id, last_day);

ALTER TABLE public.leave_streak_reviews ENABLE ROW LEVEL SECURITY;
