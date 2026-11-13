-- ============================================================
-- 學校行事曆（#1160，計畫席 11-12 gate：Q1／Q2／Q3／Q5／Q6 全取 (a)）
--
-- 各校的開學、休業式、寒暑假、補課、停課。手填（政府沒有可用 API，見 #1076），只給排課看。
-- - **不是第二條學期軸**（使用者 10-03）：全系統的時間軸只有機構的「期」（billing_periods）。
--   所以這張表**不存學年／學期**，只存日期區間；畫面用期的起訖去篩「重疊即列」（Q1 (a)）。
--   寒假這種跨 1/31 的區間也就不用決定歸哪一學期。
-- - 單日事件（開學、休業式、補課）start_date = end_date。
-- - org_id 冗餘存一份：API 每句帶 org_id（c1）。值由伺服器從學校列帶、並驗學校屬於本 org。
-- - 學校刪除 CASCADE：學校只有「沒有學生」才刪得掉，它的行事曆跟著走；
--   RESTRICT 會讓「刪不掉學校」多一個畫面上看不見的原因。
-- - audit 記在 resource_type='school'（行事曆是學校的資料，Q5 (a)），**不動** audit_logs 的 CHECK。
--
-- 純加型別＋加表，「套完才部署」或「部署完才套」都安全：舊程式碼不讀它。
-- RLS 啟用、不加 policy：fail-closed 後盾（AGENTS.md「Supabase / SQL」）。
-- ============================================================
CREATE TYPE public.school_calendar_kind AS ENUM (
  'semester_start',  -- 開學
  'semester_end',    -- 休業式
  'winter_break',    -- 寒假
  'summer_break',    -- 暑假
  'makeup_day',      -- 補課（學校補上課，學生那天在學校）
  'no_class',        -- 停課
  'other'            -- 其他
);

CREATE TABLE public.school_calendar_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  school_id  uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  kind       public.school_calendar_kind NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  note       text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_calendar_events_dates_check CHECK (end_date >= start_date),
  CONSTRAINT school_calendar_events_note_len CHECK (char_length(note) <= 200)
);

COMMENT ON TABLE public.school_calendar_events IS
  '學校行事曆（#1160）：疊在期裡的各校放假日標記，只給排課看；不存學年學期';

-- 單校視圖：某校、某段日期
CREATE INDEX school_calendar_events_school_start_idx
  ON public.school_calendar_events (school_id, start_date);
-- 產生課堂疊圖：本 org、某段日期（再以學校過濾）
CREATE INDEX school_calendar_events_org_start_idx
  ON public.school_calendar_events (org_id, start_date);

CREATE TRIGGER school_calendar_events_updated_at
  BEFORE UPDATE ON public.school_calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.school_calendar_events ENABLE ROW LEVEL SECURITY;
