-- ============================================================
-- term exam enums
-- ============================================================
CREATE TYPE public.term_exam_period AS ENUM (
  'midterm_1',
  'final_1',
  'midterm_2',
  'final_2'
);

-- ============================================================
-- term_exams
-- ============================================================
CREATE TABLE public.term_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  academic_year smallint NOT NULL,
  semester smallint NOT NULL CHECK (semester IN (1, 2)),
  period public.term_exam_period NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, academic_year, semester, period)
);

CREATE INDEX term_exams_org_id_idx ON public.term_exams (org_id);

CREATE TRIGGER term_exams_updated_at
  BEFORE UPDATE ON public.term_exams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- term_scores
-- ============================================================
CREATE TABLE public.term_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term_exam_id uuid NOT NULL REFERENCES public.term_exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  score numeric(6, 2),
  status public.score_status NOT NULL DEFAULT 'scored',
  notes text,
  created_by text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term_exam_id, student_id, subject_id)
);

CREATE INDEX term_scores_term_exam_id_idx ON public.term_scores (term_exam_id);
CREATE INDEX term_scores_student_id_idx ON public.term_scores (student_id);
CREATE INDEX term_scores_subject_id_idx ON public.term_scores (subject_id);

CREATE TRIGGER term_scores_updated_at
  BEFORE UPDATE ON public.term_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 更新 audit_logs resource_type constraint（加入 term_exam）
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
      'term_exam'
    )
  );
