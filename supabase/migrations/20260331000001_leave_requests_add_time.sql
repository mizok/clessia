-- 新增請假起訖時間欄位（nullable，不填代表全天請假）
ALTER TABLE public.leave_requests
  ADD COLUMN start_time time,
  ADD COLUMN end_time time;
