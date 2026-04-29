-- ============================================================
-- school_exam_schedules：段考依學校各自的考試日期
-- 取代 school_exams.exam_date 單一欄位
-- ============================================================
CREATE TABLE public.school_exam_schedules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_exam_id  uuid NOT NULL REFERENCES public.school_exams(id) ON DELETE CASCADE,
  school_id     uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  exam_date     date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_exam_id, school_id)
);

CREATE INDEX school_exam_schedules_school_exam_id_idx
  ON public.school_exam_schedules (school_exam_id);
CREATE INDEX school_exam_schedules_school_id_idx
  ON public.school_exam_schedules (school_id);
CREATE INDEX school_exam_schedules_exam_date_idx
  ON public.school_exam_schedules (exam_date);

CREATE TRIGGER school_exam_schedules_updated_at
  BEFORE UPDATE ON public.school_exam_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
