-- 為 courses 表新增 grade_levels
ALTER TABLE public.courses ADD COLUMN grade_levels text[] DEFAULT '{}';

-- 遷移現有資料：將班級的年級設定同步回課程（取聯集）
UPDATE public.courses c
SET grade_levels = sub.merged_grades
FROM (
  SELECT course_id, array_agg(DISTINCT grade) as merged_grades
  FROM (
    SELECT course_id, unnest(grade_levels) as grade
    FROM public.classes
  ) internal_sub
  GROUP BY course_id
) sub
WHERE c.id = sub.course_id;
