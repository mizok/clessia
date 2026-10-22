-- ============================================================
-- 學年升級（#1820，設計稿 kb/wiki/specs/admin/system/grade-promotion.md，已裁定）
--
-- 1. grade_promotions：一次執行一列。同一機構同一學年只能有一筆「沒復原」的（部分唯一索引）——
--    重複按、兩個人同時按，第二次撞唯一鍵、整筆回滾。
-- 2. grade_promotion_items：每位學生一列（升級前後的年級、是不是這次畢業停用的），復原靠它。
-- 3. organizations 兩欄：升級日（'MM-DD'，預設 '09-01'）、升級前提醒天數（預設 7）。升級日只用來提醒，不自動執行。
--
-- 寫入都走 API 的 withTx（lib/grade-promotion.ts），不用 SQL 函式（repo 不引入 RPC）。
-- 純加表＋加有預設值的欄，「套完才部署」或「部署完才套」都安全：舊程式碼不讀這些。
-- RLS 啟用、不加 policy：fail-closed 後盾（AGENTS.md「Supabase / SQL」）。
-- ============================================================
CREATE TABLE public.grade_promotions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  academic_year smallint NOT NULL,          -- 民國學年（8/1 起算），例：115
  -- ba_user.id 是 text（Better Auth 的 id 不是 uuid）；參照照既有慣例 ON DELETE SET NULL（參照不是寫 ba_*，c2 允許）
  executed_by   text NULL REFERENCES public.ba_user(id) ON DELETE SET NULL,
  executed_at   timestamptz NOT NULL DEFAULT now(),
  reverted_by   text NULL REFERENCES public.ba_user(id) ON DELETE SET NULL,
  reverted_at   timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX grade_promotions_one_active_per_year
  ON public.grade_promotions (org_id, academic_year)
  WHERE reverted_at IS NULL;

CREATE INDEX grade_promotions_org_idx ON public.grade_promotions (org_id, executed_at DESC);

CREATE TABLE public.grade_promotion_items (
  promotion_id uuid NOT NULL REFERENCES public.grade_promotions(id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id   uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  from_grade   public.grade_level NOT NULL,
  to_grade     public.grade_level NOT NULL,
  graduated    boolean NOT NULL DEFAULT false,   -- 高三：年級不變、這次改成停用
  PRIMARY KEY (promotion_id, student_id)
);

CREATE INDEX grade_promotion_items_student_idx ON public.grade_promotion_items (student_id);

ALTER TABLE public.grade_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grade_promotion_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.organizations
  ADD COLUMN grade_promotion_month_day text NOT NULL DEFAULT '09-01'
    CONSTRAINT organizations_grade_promotion_month_day_format
    CHECK (grade_promotion_month_day ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  ADD COLUMN grade_promotion_reminder_days smallint NOT NULL DEFAULT 7
    CONSTRAINT organizations_grade_promotion_reminder_days_range
    CHECK (grade_promotion_reminder_days BETWEEN 0 AND 60);

-- 稽核的 resource_type 加 'grade_promotion'（utils/audit.ts 的 union 同步加 —— 兩份清單要一起改）
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_resource_type_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_resource_type_check
  CHECK (
    resource_type IN (
      'class','course','campus','staff','session','student','parent',
      'enrollment','attendance','leave','academy_exam','school_exam','school',
      'contact_book_entry','class_log',
      'billing_period','fee_template',
      'invoice','payment_record','session_pack',
      'meal_record','billing_run',
      'subject','organization',
      'announcement',
      'public_application',
      'enrollment_request','trial_request',
      'grade_promotion'
    )
  );
