-- ============================================================
-- event_type enum
-- ============================================================
CREATE TYPE public.event_type AS ENUM ('session', 'mock_exam');

-- ============================================================
-- events 表（所有可出勤事件的父表）
-- ============================================================
CREATE TABLE public.events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type  public.event_type NOT NULL,
  title       text NOT NULL,
  campus_id   uuid REFERENCES public.campuses(id) ON DELETE SET NULL,
  event_date  date NOT NULL,
  start_time  time,
  end_time    time,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_org_date_idx ON public.events (org_id, event_date);
CREATE INDEX events_campus_idx ON public.events (campus_id);

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
