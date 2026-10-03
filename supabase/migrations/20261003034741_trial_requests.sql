-- ============================================================
-- trial_requests：家長端試聽申請（#1120）
--
-- 規格：specs/parent/trial.md、specs/public/trial.md（資料依賴寫這張表）；
-- 狀態：flows/trial.md 2（pending → scheduled → completed，中途可取消）。
-- 規格寫 `canceled`，這裡用 `cancelled` —— 跟 enrollment_request_status、sessions 等既有拼法一致。
--
-- **一列一門課**：家長一次可選多門課（規格），各門課由管理員各自安排、各自結案，
-- 所以拆成多列（同一次送出共用 created_at），course_id 才有 FK。
--
-- **不扣名額**：試聽算不算名額使用者尚未裁，先不扣（API 也不檢查額滿），PR 寫明。
--
-- 這支只做已有帳號的家長（student_id 必填）。公開試聽表單（無帳號、要存家長與學生聯絡資料）
-- 是另一張單，屆時以 ALTER 放寬 student_id 並加聯絡欄位。管理端安排（排定日期、課堂）同理另加欄位。
--
-- 純加表，「套完才部署」或「部署完才套」都安全。
-- ============================================================
CREATE TYPE public.trial_request_status AS ENUM (
  'pending',    -- 待處理
  'scheduled',  -- 已安排
  'completed',  -- 已完成
  'cancelled'   -- 已取消（家長電話取消，管理員代標）
);

CREATE TABLE public.trial_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  course_id       uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  status          public.trial_request_status NOT NULL DEFAULT 'pending',
  preferred_times text,
  note            text,
  requested_by    text NOT NULL REFERENCES public.ba_user(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trial_requests_org_status_idx ON public.trial_requests (org_id, status);
CREATE INDEX trial_requests_student_idx ON public.trial_requests (student_id);
CREATE INDEX trial_requests_course_idx ON public.trial_requests (course_id);

-- 同一個孩子對同一門課只能有一筆進行中的試聽
CREATE UNIQUE INDEX trial_requests_open_uniq
  ON public.trial_requests (student_id, course_id)
  WHERE status IN ('pending', 'scheduled');

CREATE TRIGGER trial_requests_updated_at
  BEFORE UPDATE ON public.trial_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 業務表一律啟用 RLS、不給 policy（fail-closed 後盾，AGENTS.md）
ALTER TABLE public.trial_requests ENABLE ROW LEVEL SECURITY;
