-- ============================================================
-- 續課異動申請（#1122，設計與 gate 見 issue 留言）
--
-- 家長對「下期續課預覽」的某一門期繳課提出轉班／停課（不續報）／變更繳費方式。
-- **暫停自動開單不另存旗標**（gate Q1 (a)）：該生有一筆 pending 的申請＝暫停，
-- 管理員結案（resolved）或家長撤回（withdrawn，Q2 (b)）就自動解除。
-- 一生同時只有一筆 pending（A6 p-renewal 的異動狀態是逐生的）。
--
-- 純加（新 type、新表），「套完才部署」或「部署完才套」都安全；沒有 backfill。
-- requested_by／resolved_by 只讀參照 ba_user（c2，同 enrollment_requests）。
-- ============================================================

CREATE TYPE public.renewal_request_kind AS ENUM (
  'transfer',     -- 轉班
  'stop',         -- 停課（不續報）
  'billing_mode'  -- 變更繳費方式
);

CREATE TYPE public.renewal_request_status AS ENUM (
  'pending',   -- 管理員處理中（＝該生暫停自動開單）
  'resolved',  -- 管理員已處理
  'withdrawn'  -- 家長撤回
);

CREATE TABLE public.renewal_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  enrollment_id   uuid NOT NULL REFERENCES public.enrollments(id) ON DELETE CASCADE,
  kind            public.renewal_request_kind NOT NULL,
  detail          text NOT NULL,
  note            text,
  status          public.renewal_request_status NOT NULL DEFAULT 'pending',
  requested_by    text NOT NULL REFERENCES public.ba_user(id) ON DELETE RESTRICT,
  resolved_by     text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT renewal_requests_detail_len CHECK (char_length(detail) BETWEEN 1 AND 500),
  CONSTRAINT renewal_requests_note_len CHECK (char_length(note) <= 200),
  CONSTRAINT renewal_requests_resolution_note_len CHECK (char_length(resolution_note) <= 200)
);

CREATE UNIQUE INDEX renewal_requests_pending_uniq
  ON public.renewal_requests (student_id) WHERE status = 'pending';
CREATE INDEX renewal_requests_org_status_idx ON public.renewal_requests (org_id, status);
CREATE INDEX renewal_requests_enrollment_idx ON public.renewal_requests (enrollment_id);

CREATE TRIGGER renewal_requests_updated_at
  BEFORE UPDATE ON public.renewal_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- fail-closed：開 RLS、不加 policy（授權只在 Hono middleware，c1）
ALTER TABLE public.renewal_requests ENABLE ROW LEVEL SECURITY;
