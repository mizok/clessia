-- ============================================================
-- P1 A2：帳單與收款
--
-- 業務規則的真相是 kb/wiki/rules/billing-rules.md，這裡只記 schema 層的取捨。
--
-- **能算的不存。** 帳單狀態（未繳／部分繳／繳清）與剩餘堂數都不是欄位 —— 由收款與
-- 出勤推導。計數器會飄移，而飄移之後不可除錯；推導在來源被修正時自己就對了。
--
-- ⚠️ 這支目前是全 repo 時間戳最晚的 migration，所以 audit_logs 的 resource_type
-- 清單直接寫在這裡。**若合併前有別的軌塞進更晚的 migration 又動了同一個 constraint，
-- 要另開一支時間戳最晚的收斂**（先例見 20260829110000 的檔頭 —— 先合併的不一定先執行）。
-- ============================================================

-- ============================================================
-- organizations：開帳到期日的預設天數
--
-- 對齊 billing_rules 規則 7 的實際節奏：「發袋後兩三週沒回音才催」。每張帳單的
-- due_date 仍可個別改 —— 這只是開帳時的起始值。
-- ============================================================
ALTER TABLE public.organizations
  ADD COLUMN invoice_due_days integer NOT NULL DEFAULT 14,
  ADD CONSTRAINT organizations_invoice_due_days_check CHECK (invoice_due_days >= 0);

-- ============================================================
-- classes：請假那堂扣不扣堂
--
-- billing_rules 規則 8 —— 堂數制**唯一**的結構化決定就是這一個開關。
-- `present` 與 `absent` 一律扣（學生佔了位子沒來，堂數照消耗，這件事沒有爭議）；
-- 有爭議、各家做法不同的是**請假**，所以只有它是設定值。
--
-- ⚠️ PR #30 的 grilling 總表把這個欄位寫成 `absence_deducts_session`，那是命名時的
-- 鬆散 —— 訪談原文與 rules 8 講的都是「請假」。依規則頁更正為 `leave_deducts_session`，
-- 記在這裡免得下一個人拿總表對出「不一致」。
--
-- default false：請假不扣是比較寬鬆的預設，與規則 8 的從寬語氣一致。
-- ============================================================
ALTER TABLE public.classes
  ADD COLUMN leave_deducts_session boolean NOT NULL DEFAULT false;

-- ============================================================
-- invoices：一張帳單
--
-- **不綁週期。** 週期在明細列上（invoice_items），因為一張帳單可以同時含
-- 「三月學費」與「三月餐費」與「一筆調整」—— 把週期綁在帳單上就得為每個週期各開一張。
--
-- **沒有 status 欄位。** 狀態由 items 與 payment_records 推導（lib/invoice-status.ts）。
-- ============================================================
CREATE TABLE public.invoices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  issued_at  date NOT NULL DEFAULT CURRENT_DATE,
  -- 「欠繳」的定義是「過了 due_date 未繳清」（規則 7）。nullable：還沒發袋就還沒有到期日
  due_date   date,
  note       text,
  created_by text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invoices_org_id_idx ON public.invoices (org_id);
CREATE INDEX invoices_student_idx ON public.invoices (student_id);
-- 欠繳查詢：這個 org、過了到期日的
CREATE INDEX invoices_org_due_idx ON public.invoices (org_id, due_date);

CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- invoice_items：帳單明細
--
-- **週期雙欄互斥**：期繳的列指向 billing_periods，月繳的列用 period_month
-- （該月的第一天）。兩者只能有一個，也可以都沒有（調整列、餐費列不屬於任何週期）。
-- 防重複開帳靠的就是它們 —— 「這個報名的三月學費開過了沒」是一個可查的問題。
--
-- 沒有 org_id：明細一律經由 invoice 取得，而 invoice 已經做過 org 過濾。
-- ============================================================
CREATE TYPE public.invoice_item_type AS ENUM (
  'tuition',      -- 學費
  'meal',         -- 餐費
  'session_pack', -- 買堂數
  'adjustment'    -- 人工調整（可正可負）
);

CREATE TABLE public.invoice_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  type              public.invoice_item_type NOT NULL,
  -- 學費列指向報名（誰的哪一班）。餐費與調整列沒有報名
  enrollment_id     uuid REFERENCES public.enrollments(id) ON DELETE SET NULL,
  -- **可以是負數** —— 調整列就是拿來扣的（規則 2 的人工覆寫）
  amount            numeric(10, 0) NOT NULL,
  billing_period_id uuid REFERENCES public.billing_periods(id) ON DELETE RESTRICT,
  -- 月繳的週期。存該月第一天，比 text 'YYYY-MM' 好比對也好排序
  period_month      date,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_items_period_exclusive CHECK (
    billing_period_id IS NULL OR period_month IS NULL
  ),
  -- 月繳的週期一律是該月一號，不然「3/1 的三月」與「3/15 的三月」會被當成兩個週期
  CONSTRAINT invoice_items_period_month_is_first CHECK (
    period_month IS NULL OR date_trunc('month', period_month) = period_month
  )
);

CREATE INDEX invoice_items_invoice_idx ON public.invoice_items (invoice_id);
-- 防重複開帳的查詢入口：這個報名、這個週期，開過了沒
CREATE INDEX invoice_items_enrollment_period_idx
  ON public.invoice_items (enrollment_id, billing_period_id, period_month);

-- ============================================================
-- payment_records：收款與退費
--
-- **一張帳單可對多筆收款**（規則 4：分期實務存在）。退費記為 kind = 'refund'，
-- **金額恆正** —— 正負由 kind 決定，不靠符號。負數金額在報表上加總很容易加錯邊，
-- 而 kind 是看得見的。
-- ============================================================
CREATE TYPE public.payment_kind AS ENUM ('payment', 'refund');
CREATE TYPE public.payment_method AS ENUM ('cash', 'transfer');

CREATE TABLE public.payment_records (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- org_id 是冗餘（invoice 已經有），但收據號碼要在 org 內連號，取號時得知道是哪個 org
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id  uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  kind        public.payment_kind NOT NULL DEFAULT 'payment',
  amount      numeric(10, 0) NOT NULL,
  method      public.payment_method NOT NULL,
  paid_at     date NOT NULL DEFAULT CURRENT_DATE,
  -- 轉帳憑證截圖在 Supabase Storage 的路徑。規則 5：對帳靠家長回傳截圖，不做銀行對帳
  proof_path  text,
  -- org 內連號，由 trigger 指派（見下）
  receipt_no  integer,
  note        text,
  recorded_by text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_records_amount_positive CHECK (amount > 0)
);

CREATE INDEX payment_records_invoice_idx ON public.payment_records (invoice_id);
CREATE INDEX payment_records_org_paid_idx ON public.payment_records (org_id, paid_at DESC);
CREATE UNIQUE INDEX payment_records_org_receipt_no_unique
  ON public.payment_records (org_id, receipt_no);

CREATE TRIGGER payment_records_updated_at
  BEFORE UPDATE ON public.payment_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 收據號碼：org 內連號
--
-- **為什麼是 trigger 而不是在 API 裡取號**：API 走 supabase-js（HTTP），一次呼叫一個
-- 交易 —— 「讀 max + 1 再 insert」中間沒有辦法上鎖，兩筆同時進來就會撞號，而
-- `UNIQUE (org_id, receipt_no)` 會讓其中一筆直接失敗（櫃檯正在收錢的時候）。
--
-- trigger 在**同一個交易**裡取號：`UPDATE ... RETURNING` 對計數器那一列上了行鎖，
-- 併發的第二筆會排隊等它 commit。號碼因此連續，回滾才會產生跳號 —— 那是可接受的
-- （會計上跳號要有紀錄，但這裡的 receipt_no 是內部收據編號不是統一發票號碼）。
-- ============================================================
CREATE TABLE public.receipt_counters (
  org_id  uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  next_no integer NOT NULL DEFAULT 1
);

CREATE FUNCTION public.assign_receipt_no() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 明確指定號碼時不覆寫（資料搬遷用）
  IF NEW.receipt_no IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.receipt_counters (org_id, next_no)
  VALUES (NEW.org_id, 1)
  ON CONFLICT (org_id) DO NOTHING;

  UPDATE public.receipt_counters
     SET next_no = next_no + 1
   WHERE org_id = NEW.org_id
  RETURNING next_no - 1 INTO NEW.receipt_no;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_records_assign_receipt_no
  BEFORE INSERT ON public.payment_records
  FOR EACH ROW EXECUTE FUNCTION public.assign_receipt_no();

-- ============================================================
-- payment_reminders：催繳記錄
--
-- 規則 7：催繳是**業務資料**不塞 audit_logs —— 行政要看得到「這張帳單催過幾次、
-- 用什麼方式」，那是工作流程的一部分，不是稽核軌跡。
-- ============================================================
CREATE TYPE public.reminder_method AS ENUM ('line', 'phone', 'other');

CREATE TABLE public.payment_reminders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  method     public.reminder_method NOT NULL,
  note       text,
  created_by text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_reminders_invoice_idx ON public.payment_reminders (invoice_id);

-- ============================================================
-- session_packs：買一包堂數
--
-- 買一包記一筆，**剩餘堂數不存** —— 由「Σ購買 − Σ應扣出勤」推導。存計數器的話
-- 出勤被事後修正（改點名、補請假）就會飄，而飄了之後沒有人查得出來差在哪。
--
-- `expires_at` 是**選填**：受訪公司不設效期，但通用設計留空間（規則 1）。
-- ============================================================
CREATE TABLE public.session_packs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrollment_id   uuid NOT NULL REFERENCES public.enrollments(id) ON DELETE CASCADE,
  purchased_count integer NOT NULL,
  purchased_at    date NOT NULL DEFAULT CURRENT_DATE,
  expires_at      date,
  -- 對應的帳單明細。ON DELETE SET NULL：明細被刪掉不該讓這包堂數消失
  invoice_item_id uuid REFERENCES public.invoice_items(id) ON DELETE SET NULL,
  note            text,
  created_by      text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_packs_count_positive CHECK (purchased_count > 0)
);

CREATE INDEX session_packs_org_idx ON public.session_packs (org_id);
CREATE INDEX session_packs_enrollment_idx ON public.session_packs (enrollment_id);

CREATE TRIGGER session_packs_updated_at
  BEFORE UPDATE ON public.session_packs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 業務表一律啟用 RLS 但不建 policy：service role 會繞過它，授權真正發生在
-- Hono middleware（c1）。fail-closed 後盾，harness gate A8 守著。
-- ============================================================
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_counters ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- audit_logs 的 resource_type：完整清單（見檔頭的警告）
-- ============================================================
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_resource_type_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_resource_type_check
  CHECK (
    resource_type IN (
      'class','course','campus','staff','session','student','parent',
      'enrollment','attendance','leave','academy_exam','school_exam','school',
      'contact_book_entry','class_log',
      'billing_period','fee_template',
      'invoice','payment_record','session_pack'
    )
  );
