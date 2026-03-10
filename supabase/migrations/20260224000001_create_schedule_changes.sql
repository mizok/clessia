CREATE TYPE public.schedule_change_type AS ENUM ('reschedule', 'substitute', 'cancellation');

CREATE TABLE public.schedule_changes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id            uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  change_type           public.schedule_change_type NOT NULL,
  new_session_date      date,
  new_start_time        time,
  new_end_time          time,
  substitute_teacher_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  reason                text,
  created_by_name       text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX schedule_changes_org_id_idx ON public.schedule_changes(org_id, created_at DESC);
CREATE INDEX schedule_changes_session_id_idx ON public.schedule_changes(session_id);

COMMENT ON TABLE public.schedule_changes IS '課務異動紀錄（調課/代課/停課）';
