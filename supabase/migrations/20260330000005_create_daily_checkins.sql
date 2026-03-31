-- ============================================================
-- daily_checkins 表（日到班打卡，用於 daily_checkin 模式）
-- ============================================================
CREATE TABLE public.daily_checkins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campus_id       uuid REFERENCES public.campuses(id) ON DELETE SET NULL,
  student_id      uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  checkin_date    date NOT NULL,
  checked_in_at   timestamptz NOT NULL DEFAULT now(),
  checked_in_by   text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, checkin_date)
);

CREATE INDEX daily_checkins_org_date_idx ON public.daily_checkins (org_id, checkin_date);
CREATE INDEX daily_checkins_student_idx ON public.daily_checkins (student_id);
