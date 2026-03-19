-- ============================================================
-- enrollment_status enum
-- ============================================================
CREATE TYPE public.enrollment_status AS ENUM (
  'pending_payment',
  'active',
  'suspended',
  'withdrawal',
  'void'
);

-- ============================================================
-- payment_cycle enum
-- ============================================================
CREATE TYPE public.payment_cycle AS ENUM (
  'monthly',
  'semester'
);

-- ============================================================
-- enrollments 表（業務表不使用 RLS，授權邏輯在 Hono middleware 層）
-- ============================================================
CREATE TABLE public.enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  status public.enrollment_status NOT NULL DEFAULT 'active',
  payment_cycle public.payment_cycle,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  notes text,
  created_by text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX enrollments_org_id_idx ON public.enrollments (org_id);
CREATE INDEX enrollments_class_id_idx ON public.enrollments (class_id);
CREATE INDEX enrollments_student_id_idx ON public.enrollments (student_id);
CREATE INDEX enrollments_status_idx ON public.enrollments (status);

-- 同一學生在同一班只能有一筆非終態 enrollment（允許退班後重新加入）
CREATE UNIQUE INDEX enrollments_active_class_student_unique
  ON public.enrollments (class_id, student_id)
  WHERE status NOT IN ('withdrawal', 'void');

CREATE TRIGGER enrollments_updated_at
  BEFORE UPDATE ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 更新 audit_logs resource_type constraint（加入 enrollment、student）
-- ============================================================
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_resource_type_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_resource_type_check
  CHECK (resource_type IN ('class', 'course', 'campus', 'staff', 'session', 'student', 'enrollment'));
