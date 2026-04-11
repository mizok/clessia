-- ============================================================
-- 考務與成績重構 — Schema 變更
-- ============================================================

-- 1. academy_exam_status enum: 移除 draft，改預設為 active
--    PostgreSQL 不能直接 DROP enum value，需要重建 enum
ALTER TYPE public.academy_exam_status RENAME TO academy_exam_status_old;

CREATE TYPE public.academy_exam_status AS ENUM ('active', 'closed');

-- 先把現有 draft/published 都遷移到 active
ALTER TABLE public.academy_exams
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.academy_exams
  ALTER COLUMN status TYPE public.academy_exam_status
  USING (
    CASE status::text
      WHEN 'draft' THEN 'active'::public.academy_exam_status
      WHEN 'published' THEN 'active'::public.academy_exam_status
      WHEN 'closed' THEN 'closed'::public.academy_exam_status
    END
  );

ALTER TABLE public.academy_exams
  ALTER COLUMN status SET DEFAULT 'active';

DROP TYPE public.academy_exam_status_old;

-- 2. term_exams: 新增 exam_date 和 status
CREATE TYPE public.term_exam_status AS ENUM ('active', 'closed');

ALTER TABLE public.term_exams
  ADD COLUMN exam_date date,
  ADD COLUMN status public.term_exam_status NOT NULL DEFAULT 'active';

CREATE INDEX term_exams_exam_date_idx ON public.term_exams (exam_date);
CREATE INDEX term_exams_status_idx ON public.term_exams (status);
