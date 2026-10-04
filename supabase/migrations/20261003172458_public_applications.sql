-- ============================================================
-- public_applications：公開表單（免登入）送進來的報名／試聽申請（#1123、#1124）
--
-- 規格：specs/public/enrollment.md、specs/public/trial.md。
--
-- **為什麼不寫進 enrollment_requests／trial_requests**：那兩張是家長端（已登入、孩子已建檔）的申請表，
-- `student_id` 與 `requested_by`（ba_user）都 NOT NULL。公開表單的人沒有帳號、孩子沒有學生資料，
-- 而 rules/enrollment-rules.md 1.4 是「首次收款時」才建家長與學生 —— 不是送出時。
-- 送出時直接建帳號等於讓匿名請求建帳號（最大的濫用面），所以未驗證的申請另存一張表，
-- 管理員聯絡過、確認了才走既有的建檔與報名流程（計畫席 10-04 裁 A）。
--
-- 狀態是**聯絡流程**，不是報名狀態機：converted 之後的事都在既有的表上發生。
--
-- 純加表，「套完才部署」或「部署完才套」都安全：舊程式碼不碰它。
-- ============================================================
CREATE TYPE public.public_application_kind AS ENUM ('enrollment', 'trial');

CREATE TYPE public.public_application_status AS ENUM (
  'new',        -- 剛送進來
  'contacted',  -- 已聯絡
  'converted',  -- 已轉成正式報名／試聽
  'rejected',   -- 不受理
  'spam'        -- 垃圾送件
);

CREATE TABLE public.public_applications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind                 public.public_application_kind NOT NULL,
  status               public.public_application_status NOT NULL DEFAULT 'new',
  parent_name          text NOT NULL,
  parent_email         text,
  parent_phone         text,
  -- 父親／母親／其他；同 parent_student_relations.relation 是 text
  parent_relation      text NOT NULL,
  student_name         text NOT NULL,
  student_grade        public.grade_level NOT NULL,
  -- 原文；審核時再對到 schools
  student_school       text NOT NULL,
  -- 報名用
  preferred_start_date date,
  -- 試聽用（「週三晚上」）
  preferred_times      text,
  note                 text,
  -- 個資同意的時間（伺服器時間，不信前端）
  consented_at         timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_applications_contact_check
    CHECK (parent_email IS NOT NULL OR parent_phone IS NOT NULL)
);

-- 審核頁：本 org、依狀態、新的在前
CREATE INDEX public_applications_org_status_idx
  ON public.public_applications (org_id, status, created_at DESC);

CREATE TRIGGER public_applications_updated_at
  BEFORE UPDATE ON public.public_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 想報的班（kind=enrollment）或想試聽的課程（kind=trial），一列一個。
-- 班／課程被刪時 SET NULL 而不是連申請一起刪：申請是「有人來問過」的紀錄，審核頁顯示「已刪除的班」。
-- 「班或課程至少一個」不下 CHECK —— SET NULL 之後兩個都可能是 NULL；插入時由 API 保證。
CREATE TABLE public.public_application_targets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.public_applications(id) ON DELETE CASCADE,
  class_id       uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  course_id      uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  -- 送出當下已額滿（伺服器數：上限 − active／pending_payment），使用者 10-03 裁「額滿班登記候補」
  is_waitlist    boolean NOT NULL DEFAULT false
);

CREATE INDEX public_application_targets_application_idx
  ON public.public_application_targets (application_id);
-- FK 欄位的索引：刪班／刪課程時 SET NULL 要找到掛著它的列
CREATE INDEX public_application_targets_class_idx ON public.public_application_targets (class_id);
CREATE INDEX public_application_targets_course_idx ON public.public_application_targets (course_id);

-- 業務表一律啟用 RLS、不給 policy（fail-closed 後盾，AGENTS.md；harness A8 守）
ALTER TABLE public.public_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_application_targets ENABLE ROW LEVEL SECURITY;
