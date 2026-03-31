-- ============================================================
-- attendance_status enum
-- ============================================================
CREATE TYPE public.attendance_status AS ENUM ('present', 'absent', 'on_leave');

-- ============================================================
-- attendance_records 表
-- ============================================================
CREATE TABLE public.attendance_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  status          public.attendance_status NOT NULL DEFAULT 'absent',
  note            text,
  recorded_by     text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  recorded_by_role text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, student_id)
);

CREATE INDEX attendance_records_org_idx ON public.attendance_records (org_id);
CREATE INDEX attendance_records_student_idx ON public.attendance_records (student_id);
CREATE INDEX attendance_records_event_idx ON public.attendance_records (event_id);

CREATE TRIGGER attendance_records_updated_at
  BEFORE UPDATE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
