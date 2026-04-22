-- ============================================================
-- academy exam enums
-- ============================================================
CREATE TYPE public.academy_exam_status AS ENUM (
  'draft',
  'published',
  'closed'
);

CREATE TYPE public.academy_exam_type AS ENUM (
  'quiz',
  'mock_exam',
  'placement_test'
);

CREATE TYPE public.score_status AS ENUM (
  'scored',
  'absent',
  'makeup'
);

-- ============================================================
-- academy_exams
-- ============================================================
CREATE TABLE public.academy_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campus_id uuid REFERENCES public.campuses(id) ON DELETE SET NULL,
  name text NOT NULL,
  exam_type public.academy_exam_type NOT NULL DEFAULT 'quiz',
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  exam_date date NOT NULL,
  total_score smallint NOT NULL DEFAULT 100,
  scope_note text,
  status public.academy_exam_status NOT NULL DEFAULT 'draft',
  created_by text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX academy_exams_org_id_idx ON public.academy_exams (org_id);
CREATE INDEX academy_exams_campus_id_idx ON public.academy_exams (campus_id);
CREATE INDEX academy_exams_subject_id_idx ON public.academy_exams (subject_id);
CREATE INDEX academy_exams_exam_date_idx ON public.academy_exams (exam_date);
CREATE INDEX academy_exams_status_idx ON public.academy_exams (status);

CREATE TRIGGER academy_exams_updated_at
  BEFORE UPDATE ON public.academy_exams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- academy_exam_classes
-- ============================================================
CREATE TABLE public.academy_exam_classes (
  exam_id uuid NOT NULL REFERENCES public.academy_exams(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  PRIMARY KEY (exam_id, class_id)
);

-- ============================================================
-- academy_scores
-- ============================================================
CREATE TABLE public.academy_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.academy_exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  score numeric(6, 2),
  status public.score_status NOT NULL DEFAULT 'scored',
  notes text,
  created_by text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id)
);

CREATE INDEX academy_scores_exam_id_idx ON public.academy_scores (exam_id);
CREATE INDEX academy_scores_student_id_idx ON public.academy_scores (student_id);

CREATE TRIGGER academy_scores_updated_at
  BEFORE UPDATE ON public.academy_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 更新 audit_logs resource_type constraint（加入 academy_exam）
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
      'academy_exam'
    )
  );
