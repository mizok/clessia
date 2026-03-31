-- ============================================================
-- 在 sessions 加入 event_id FK（可為 null，允許存量資料）
-- ============================================================
ALTER TABLE public.sessions
  ADD COLUMN event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;

-- ============================================================
-- Backfill：為每個現有 session 建立對應的 event 紀錄
-- ============================================================
INSERT INTO public.events (id, org_id, event_type, title, campus_id, event_date, start_time, end_time, created_at, updated_at)
SELECT
  gen_random_uuid(),
  s.org_id,
  'session'::public.event_type,
  COALESCE(c.name || ' - ' || crs.name, c.name, '課堂'),
  c.campus_id,
  s.session_date,
  s.start_time,
  s.end_time,
  s.created_at,
  s.updated_at
FROM public.sessions s
LEFT JOIN public.classes c ON c.id = s.class_id
LEFT JOIN public.courses crs ON crs.id = c.course_id;

-- ============================================================
-- 將 event_id 回填到 sessions（根據 org_id + session_date + start_time + end_time 匹配）
-- ============================================================
UPDATE public.sessions s
SET event_id = e.id
FROM public.events e
WHERE e.event_type = 'session'
  AND e.org_id = s.org_id
  AND e.event_date = s.session_date
  AND (e.start_time = s.start_time OR (e.start_time IS NULL AND s.start_time IS NULL))
  AND (e.end_time = s.end_time OR (e.end_time IS NULL AND s.end_time IS NULL));

CREATE INDEX sessions_event_id_idx ON public.sessions (event_id);
