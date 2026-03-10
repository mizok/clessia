-- 班級名稱唯一性改為「同課程內不可重複」
ALTER TABLE public.classes
DROP CONSTRAINT IF EXISTS classes_campus_name_key;

ALTER TABLE public.classes
ADD CONSTRAINT classes_course_name_key UNIQUE (course_id, name);
