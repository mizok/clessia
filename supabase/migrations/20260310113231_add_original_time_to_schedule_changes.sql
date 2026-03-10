-- Add original date/time fields to schedule_changes for reschedule records
ALTER TABLE public.schedule_changes
  ADD COLUMN original_session_date date,
  ADD COLUMN original_start_time   time,
  ADD COLUMN original_end_time     time;

COMMENT ON COLUMN public.schedule_changes.original_session_date IS '調課前的原始日期（僅 reschedule 類型有值）';
COMMENT ON COLUMN public.schedule_changes.original_start_time   IS '調課前的原始開始時間（僅 reschedule 類型有值）';
COMMENT ON COLUMN public.schedule_changes.original_end_time     IS '調課前的原始結束時間（僅 reschedule 類型有值）';
