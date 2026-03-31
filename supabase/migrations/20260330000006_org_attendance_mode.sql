-- ============================================================
-- attendance_mode enum
-- ============================================================
CREATE TYPE public.attendance_mode AS ENUM ('per_session', 'daily_checkin');

-- ============================================================
-- 為 organizations 加入 attendance_mode 欄位
-- ============================================================
ALTER TABLE public.organizations
  ADD COLUMN attendance_mode public.attendance_mode NOT NULL DEFAULT 'per_session';
