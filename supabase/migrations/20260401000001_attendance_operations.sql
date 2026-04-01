-- 出勤作業台重設計 schema 變更
-- 2026-04-01

-- 1. events 新增 attendance_taken_at
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS attendance_taken_at timestamptz;

-- 2. organizations 新增出勤責任設定欄位
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS attendance_responsible text
    NOT NULL DEFAULT 'admin'
    CHECK (attendance_responsible IN ('admin', 'teacher')),
  ADD COLUMN IF NOT EXISTS attendance_retroactive_days integer
    NOT NULL DEFAULT 0
    CHECK (attendance_retroactive_days >= 0);

COMMENT ON COLUMN public.events.attendance_taken_at
  IS '首次完成點名的時間，NULL 代表尚未點名，immutable（補正不更新）';
COMMENT ON COLUMN public.organizations.attendance_responsible
  IS '點名責任方：admin（預設）或 teacher';
COMMENT ON COLUMN public.organizations.attendance_retroactive_days
  IS '補點名期限天數，0 代表無限制';
