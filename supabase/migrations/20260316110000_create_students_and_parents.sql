CREATE TYPE public.grade_level AS ENUM (
  'K',
  'P1', 'P2', 'P3', 'P4', 'P5', 'P6',
  'J1', 'J2', 'J3',
  'S1', 'S2', 'S3'
);

CREATE TYPE public.student_gender AS ENUM (
  'male', 'female', 'prefer_not_to_say'
);

CREATE TABLE public.students (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES public.organizations(id),
  name                    TEXT NOT NULL,
  grade                   public.grade_level NOT NULL,
  school                  TEXT NOT NULL,
  birthday                DATE,
  gender                  public.student_gender,
  phone                   TEXT,
  address                 TEXT,
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,
  notes                   TEXT,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX students_org_id_idx ON public.students (org_id);
CREATE INDEX students_name_idx ON public.students (name);
CREATE INDEX students_grade_idx ON public.students (grade);
CREATE INDEX students_active_idx ON public.students (is_active);

CREATE TRIGGER students_updated_at
  BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.parents (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id),
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  notes      TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX parents_org_id_idx ON public.parents (org_id);
CREATE INDEX parents_name_idx ON public.parents (name);

CREATE TRIGGER parents_updated_at
  BEFORE UPDATE ON public.parents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.parent_student_relations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  UUID NOT NULL REFERENCES public.parents(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  relation   TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(parent_id, student_id)
);

CREATE INDEX psr_student_id_idx ON public.parent_student_relations (student_id);
CREATE INDEX psr_parent_id_idx ON public.parent_student_relations (parent_id);

ALTER TABLE public.audit_logs
  DROP CONSTRAINT audit_logs_resource_type_check;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_resource_type_check
  CHECK (resource_type IN ('class', 'course', 'campus', 'staff', 'session', 'student'));
