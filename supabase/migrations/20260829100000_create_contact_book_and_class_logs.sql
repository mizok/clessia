-- ============================================================
-- 聯絡簿與教務日誌
--
-- 這兩個東西在補習班口語裡都叫「聯絡簿」，但**粒度完全不同**，所以是兩張表：
--   contact_book_entries  學生 × 日期  自由敘述（國小模式，小孩帶回家給家長簽）
--   class_logs            班級 × 日期  教學紀錄 + 作業安排（國中模式，各科老師合寫）
--
-- 班級的 uses_contact_book 開關就是模式選擇，兩者正交 —— 想「國中也寫個人評語」
-- 只是開關組合，不用改結構。
--
-- 設計真相：kb/wiki/rules/contact-book-rules.md、kb/wiki/rules/teaching-log-rules.md
-- ============================================================

-- ============================================================
-- contact_book_entries：每生每日唯一一則（rules 1）
--
-- 內容不分科目 —— 紙本現實就沒有科目維度，一天上多個班也是同一篇。
-- 共編只記最後編輯者，不做分段作者（rules 3）。
-- ============================================================
CREATE TABLE public.contact_book_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id     uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  entry_date     date NOT NULL,
  content        text NOT NULL,
  last_edited_by text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  -- 家長簽收（rules 4）。簽收端點本身是 P4 的家長端工作，欄位先立好，
  -- 免得屆時為了兩個欄位再開一支 migration。
  signed_by      text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  signed_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- 每生每日一則。這條 unique 就是 upsert 的衝突目標
  CONSTRAINT contact_book_entries_student_date_key UNIQUE (student_id, entry_date)
);

CREATE INDEX contact_book_entries_org_id_idx ON public.contact_book_entries (org_id);
-- 列表一律「某個組織、某段日期區間、日期倒序」
CREATE INDEX contact_book_entries_org_date_idx
  ON public.contact_book_entries (org_id, entry_date DESC);
-- 管理端要查「哪些還沒簽」（rules 4）
CREATE INDEX contact_book_entries_unsigned_idx
  ON public.contact_book_entries (org_id, entry_date DESC)
  WHERE signed_at IS NULL;

CREATE TRIGGER contact_book_entries_updated_at
  BEFORE UPDATE ON public.contact_book_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- class_logs：班級 × 日期，一班一天一篇（不掛 session）
--
-- 表名刻意避開既有的 teaching-log —— 那是**授課時數統計**，完全不同的東西。
--
-- published_at 是廣播扳機：NULL = 草稿；有值 = 已發布。發布後家長端可見、
-- P4 接上 LINE 推播。教學紀錄預設內部、作業安排家長可見，所以兩欄分開存
-- （rules 4）—— 將來要做可見性開關時不必拆欄位。
-- ============================================================
CREATE TABLE public.class_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  class_id        uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  log_date        date NOT NULL,
  teaching_record text NOT NULL DEFAULT '',
  homework        text NOT NULL DEFAULT '',
  last_edited_by  text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT class_logs_class_date_key UNIQUE (class_id, log_date)
);

CREATE INDEX class_logs_org_id_idx ON public.class_logs (org_id);
CREATE INDEX class_logs_org_date_idx ON public.class_logs (org_id, log_date DESC);
-- 家長端只看得到已發布的（P4）；管理端要挑出還沒發的草稿
CREATE INDEX class_logs_published_idx
  ON public.class_logs (org_id, published_at DESC)
  WHERE published_at IS NOT NULL;

CREATE TRIGGER class_logs_updated_at
  BEFORE UPDATE ON public.class_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- log_acknowledgements：國中家長對作業的「已閱」
--
-- 粒度是 log × 學生，不是 log × 家長 —— 兩個小孩修同一班，家長要各簽各的
-- （rules 4）。acknowledged_by 記的是按下按鈕的帳號。
--
-- 這張表要等 P4 的家長端才會有寫入者，但它是 class_logs 的一部分，
-- 分開兩支 migration 只會讓兩張表的關係更難讀。
-- ============================================================
CREATE TABLE public.log_acknowledgements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_log_id    uuid NOT NULL REFERENCES public.class_logs(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  acknowledged_by text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT log_acknowledgements_log_student_key UNIQUE (class_log_id, student_id)
);

CREATE INDEX log_acknowledgements_student_id_idx ON public.log_acknowledgements (student_id);

-- ============================================================
-- classes.uses_contact_book：班級層級的模式開關（rules 2）
--
-- 預設 false —— 現況全是紙本，開了才代表這個班要用電子聯絡簿。
-- ============================================================
ALTER TABLE public.classes
  ADD COLUMN uses_contact_book boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.classes.uses_contact_book IS
  '是否使用個人聯絡簿（國小模式）。國中班關閉，改用 class_logs 教務日誌。';

-- ============================================================
-- organizations.junior_high_ack_enabled：國中作業「已閱」的 org 層開關
--
-- 現實中國中家長從不簽名，所以預設關。開了才在家長端對教務日誌的作業
-- 顯示已閱按鈕（rules 4）。org 設定沿用既有慣例，掛在 organizations 表上。
-- ============================================================
ALTER TABLE public.organizations
  ADD COLUMN junior_high_ack_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.junior_high_ack_enabled IS
  '國中家長是否要對教務日誌的作業按「已閱」。預設關 —— 現實中國中家長不簽名。';

-- ============================================================
-- audit_logs 的 resource_type 加入這兩個新資源
--
-- 既有慣例：DROP CONSTRAINT + ADD 完整清單。跟同期的其他 migration 併起來時，
-- 後合的那支要把前一支的新值一起併進這份清單。
-- ============================================================
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_resource_type_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_resource_type_check
  CHECK (
    resource_type IN (
      'class','course','campus','staff','session','student','parent',
      'enrollment','attendance','leave','academy_exam','school_exam','school',
      'contact_book_entry','class_log'
    )
  );

-- ============================================================
-- 業務表一律啟用 RLS 但不建 policy：service role 會繞過它，
-- 授權真正發生在 Hono middleware（c1）。這是 fail-closed 後盾 ——
-- 將來若真的接上 anon client，會被全拒而不是全放。
-- ============================================================
ALTER TABLE public.contact_book_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.log_acknowledgements ENABLE ROW LEVEL SECURITY;
