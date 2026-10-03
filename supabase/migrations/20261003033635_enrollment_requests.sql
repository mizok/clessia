-- ============================================================
-- enrollment_requests：家長端報名申請（#1119）
--
-- 規格：specs/parent/enrollment.md、specs/public/enrollment.md（資料依賴都寫這張表）；
-- 狀態機：rules/enrollment-rules.md 1（pending → 核准後 awaiting_payment → completed）。
--
-- **waitlist**：使用者 2026-10-03 裁「額滿班不能送正式申請，但要能登記候補讓補習班知道」。
-- 額滿與否由 API 判斷（不信家長送來的任何旗標），額滿時這一列直接是 waitlist。
--
-- 這支只建表；核准（開帳、建 enrollment）是管理端的另一張單，所以沒有 invoice 相關欄位 ——
-- 核准建出的 enrollment 記在 `enrollment_id`，帳單從 enrollment 追得到。
--
-- 純加表，「套完才部署」或「部署完才套」都安全：舊程式碼不碰它；新程式碼在表不存在時
-- 家長端這兩支回 500，不影響其他路徑。
-- ============================================================
CREATE TYPE public.enrollment_request_status AS ENUM (
  'pending',          -- 待審核
  'waitlist',         -- 額滿候補（10-03 裁）
  'awaiting_payment', -- 已核准、待繳費
  'completed',        -- 已完成
  'rejected',         -- 已拒絕
  'cancelled',        -- 家長取消
  'expired'           -- 已過期
);

CREATE TABLE public.enrollment_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id           uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  class_id             uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  status               public.enrollment_request_status NOT NULL DEFAULT 'pending',
  preferred_start_date date,
  note                 text,
  reject_reason        text,
  enrollment_id        uuid REFERENCES public.enrollments(id) ON DELETE SET NULL,
  requested_by         text NOT NULL REFERENCES public.ba_user(id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX enrollment_requests_org_status_idx ON public.enrollment_requests (org_id, status);
CREATE INDEX enrollment_requests_student_idx ON public.enrollment_requests (student_id);
CREATE INDEX enrollment_requests_class_idx ON public.enrollment_requests (class_id);

-- 同一個孩子對同一班只能有一筆「還在進行中」的申請（重按送出不會變兩筆）
CREATE UNIQUE INDEX enrollment_requests_open_uniq
  ON public.enrollment_requests (student_id, class_id)
  WHERE status IN ('pending', 'waitlist', 'awaiting_payment');

CREATE TRIGGER enrollment_requests_updated_at
  BEFORE UPDATE ON public.enrollment_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 業務表一律啟用 RLS、不給 policy（fail-closed 後盾，AGENTS.md）
ALTER TABLE public.enrollment_requests ENABLE ROW LEVEL SECURITY;
