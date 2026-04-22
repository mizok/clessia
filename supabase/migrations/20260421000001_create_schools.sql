-- ============================================================
-- schools：就讀學校 entity（取代 students.school 自由文字）
-- ============================================================
CREATE TABLE public.schools (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  short_name  text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX schools_org_id_idx ON public.schools (org_id);
CREATE INDEX schools_is_active_idx ON public.schools (is_active);

CREATE TRIGGER schools_updated_at
  BEFORE UPDATE ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- students 加上 school_id FK（先 nullable，後續 migration 回填後可視情況設 NOT NULL）
ALTER TABLE public.students
  ADD COLUMN school_id uuid REFERENCES public.schools(id) ON DELETE RESTRICT;

CREATE INDEX students_school_id_idx ON public.students (school_id);

-- audit_logs resource_type 加入 'school'
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_resource_type_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_resource_type_check
  CHECK (
    resource_type IN (
      'class','course','campus','staff','session','student','parent',
      'enrollment','attendance','leave','academy_exam','term_exam','school'
    )
  );
