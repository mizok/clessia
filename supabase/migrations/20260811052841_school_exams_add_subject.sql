-- school_exams 增加 subject_id：只有 exam_type = 'other' 的考試才會綁定科目。
--
-- 這段內容原本是**直接改進 20260410000002_create_school_exams.sql 的建表語句**裡的，
-- 違反憲法 c3（已提交的 migration 不可修改）。本機 db:reset 會重跑全部所以看不出問題，
-- 但任何已經跑過那支 migration 的環境永遠不會拿到這個欄位。改成獨立的 ALTER migration。
--
-- （查證過：本專案目前沒有 link 任何遠端 Supabase 專案，environment.production.ts 也還是
--  佔位符，所以此刻沒有環境受影響。這支 migration 的意義在於上線後不會踩到同一個坑。）

ALTER TABLE public.school_exams
  ADD COLUMN subject_id uuid REFERENCES public.subjects(id) ON DELETE RESTRICT;

-- subject_id 只在「其他」類型的考試上有意義：段考／期末考等固定類型本來就跨科。
ALTER TABLE public.school_exams
  ADD CONSTRAINT school_exams_subject_only_when_other
  CHECK (exam_type = 'other' OR subject_id IS NULL);

CREATE INDEX school_exams_subject_id_idx ON public.school_exams (subject_id);

COMMENT ON COLUMN public.school_exams.subject_id
  IS '僅 exam_type = ''other'' 時可有值，由 school_exams_subject_only_when_other 約束';
