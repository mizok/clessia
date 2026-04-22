-- ============================================================
-- term_exam_schedules：段考依學校各自的考試日期
-- 取代 term_exams.exam_date 單一欄位
-- ============================================================
CREATE TABLE public.term_exam_schedules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term_exam_id  uuid NOT NULL REFERENCES public.term_exams(id) ON DELETE CASCADE,
  school_id     uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  exam_date     date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term_exam_id, school_id)
);

CREATE INDEX term_exam_schedules_term_exam_id_idx
  ON public.term_exam_schedules (term_exam_id);
CREATE INDEX term_exam_schedules_school_id_idx
  ON public.term_exam_schedules (school_id);
CREATE INDEX term_exam_schedules_exam_date_idx
  ON public.term_exam_schedules (exam_date);

CREATE TRIGGER term_exam_schedules_updated_at
  BEFORE UPDATE ON public.term_exam_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
