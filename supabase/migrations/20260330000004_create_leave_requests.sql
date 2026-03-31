-- ============================================================
-- leave_requests 表
-- ============================================================
CREATE TABLE public.leave_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  reason          text,
  submitted_by    text NOT NULL REFERENCES public.ba_user(id) ON DELETE RESTRICT,
  submitted_by_role text NOT NULL CHECK (submitted_by_role IN ('parent', 'admin')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leave_requests_org_idx ON public.leave_requests (org_id);
CREATE INDEX leave_requests_student_idx ON public.leave_requests (student_id);
CREATE INDEX leave_requests_date_range_idx ON public.leave_requests (org_id, start_date, end_date);

CREATE TRIGGER leave_requests_updated_at
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
