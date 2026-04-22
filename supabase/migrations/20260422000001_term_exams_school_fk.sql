-- ============================================================
-- term_exams: 一場段考綁定一所學校（取代 term_exam_schedules 多校排程設計）
-- 唯一鍵改為 (org_id, school_id, academic_year, semester, period)
-- ============================================================

-- 1. 移除 term_exam_schedules（多校排程表）
DROP TABLE IF EXISTS public.term_exam_schedules;

-- 2. 刪除舊的 unique constraint
ALTER TABLE public.term_exams
  DROP CONSTRAINT IF EXISTS term_exams_org_id_academic_year_semester_period_key;

-- 3. 加上 school_id 欄位（NOT NULL；migration 執行時表應為空）
ALTER TABLE public.term_exams
  ADD COLUMN school_id uuid NOT NULL
    REFERENCES public.schools(id) ON DELETE RESTRICT;

CREATE INDEX term_exams_school_id_idx ON public.term_exams (school_id);

-- 4. 新的 unique：同一學校同一學年同一學期同一時段只能一場
ALTER TABLE public.term_exams
  ADD CONSTRAINT term_exams_org_school_year_sem_period_key
    UNIQUE (org_id, school_id, academic_year, semester, period);
