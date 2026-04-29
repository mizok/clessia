-- ============================================================
-- school_exams: 一場考試綁定一所學校（取代 school_exam_schedules 多校排程設計）
-- 允許同校同學期多場考試（以 name / exam_date 區分）
-- ============================================================

-- 1. 移除 school_exam_schedules（多校排程表）
DROP TABLE IF EXISTS public.school_exam_schedules;

-- 2. 刪除舊的 partial unique index（新規則不再限制同學期同類型唯一）
DROP INDEX IF EXISTS public.school_exams_unique_term_idx;

-- 3. 加上 school_id 欄位（NOT NULL；migration 執行時表應為空）
ALTER TABLE public.school_exams
  ADD COLUMN school_id uuid NOT NULL
    REFERENCES public.schools(id) ON DELETE RESTRICT;

CREATE INDEX school_exams_school_id_idx ON public.school_exams (school_id);
