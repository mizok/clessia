-- ============================================================
-- term exam enums
-- ============================================================
-- exam_type：學校考試的子類型
--   段考：term_exam
--   模擬考：mock_exam
--   其他：other（需填 name）
CREATE TYPE public.school_exam_type AS ENUM (
  'term_exam',
  'mock_exam',
  'other'
);

-- ============================================================
-- school_exams
-- ============================================================
CREATE TABLE public.school_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  academic_year smallint NOT NULL,
  semester smallint NOT NULL CHECK (semester IN (1, 2)),
  exam_type public.school_exam_type NOT NULL,
  name text,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_exams_name_required_for_other CHECK (
    exam_type <> 'other' OR (name IS NOT NULL AND btrim(name) <> '')
  )
);

CREATE INDEX school_exams_org_id_idx ON public.school_exams (org_id);

CREATE TRIGGER school_exams_updated_at
  BEFORE UPDATE ON public.school_exams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- school_scores
-- ============================================================
CREATE TABLE public.school_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_exam_id uuid NOT NULL REFERENCES public.school_exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  score numeric(6, 2),
  status public.score_status NOT NULL DEFAULT 'scored',
  notes text,
  created_by text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_exam_id, student_id, subject_id)
);

CREATE INDEX school_scores_school_exam_id_idx ON public.school_scores (school_exam_id);
CREATE INDEX school_scores_student_id_idx ON public.school_scores (student_id);
CREATE INDEX school_scores_subject_id_idx ON public.school_scores (subject_id);

CREATE TRIGGER school_scores_updated_at
  BEFORE UPDATE ON public.school_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 更新 audit_logs resource_type constraint（加入 school_exam）
-- ============================================================
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_resource_type_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_resource_type_check
  CHECK (
    resource_type IN (
      'class',
      'course',
      'campus',
      'staff',
      'session',
      'student',
      'parent',
      'enrollment',
      'attendance',
      'leave',
      'academy_exam',
      'school_exam'
    )
  );
