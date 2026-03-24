-- 為班級加入有效期間欄位（皆可為 null，代表無限制）
ALTER TABLE public.classes
  ADD COLUMN start_date date,
  ADD COLUMN end_date date;

COMMENT ON COLUMN public.classes.start_date IS '班級開始日期（null = 無限制）';
COMMENT ON COLUMN public.classes.end_date IS '班級結束日期（null = 無限制）';
