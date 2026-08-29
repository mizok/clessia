-- ============================================================
-- P1 A3：餐務 + 每月帳務作業需要的 schema
--
-- 業務規則見 kb/wiki/rules/meal-rules.md。
--
-- ⚠️ 這支目前是全 repo 時間戳最晚的 migration，所以 audit_logs 的 resource_type
-- 清單直接寫在這裡。**若合併前有別軌塞進更晚的 migration 又動了同一個 constraint，
-- 要另開一支時間戳最晚的收斂** —— 先合併的不一定先執行，見 20260829110000 的檔頭。
-- ============================================================

-- ============================================================
-- students.meal_default：訂不訂餐的預設（opt-in）
--
-- meal-rules 規則 1：**有上課 ≠ 有訂餐**。有學生天天到班但家長不訂便當，所以
-- 課表只產生候選名單，這個欄位決定候選裡誰預設是勾起來的。
-- ============================================================
ALTER TABLE public.students
  ADD COLUMN meal_default boolean NOT NULL DEFAULT false;

-- ============================================================
-- organizations：餐費預設單價 + 插班比例的基準
-- ============================================================
CREATE TYPE public.proration_basis AS ENUM ('days', 'sessions');

ALTER TABLE public.organizations
  -- 單價存在每一筆餐記錄上（便當價格會變動），這裡只是開單時的起始值
  ADD COLUMN meal_default_price numeric(10, 0) NOT NULL DEFAULT 0,
  -- **預設 days**：按天永遠算得出來；按堂依賴 sessions 已經生成，而學期中段
  -- 可能還沒排完。訪談說基準是 case-by-case —— run 用預設值，例外由行政改
  -- item 金額（billing-rules 規則 2 的人工覆寫），不做規則引擎
  ADD COLUMN proration_basis public.proration_basis NOT NULL DEFAULT 'days',
  ADD CONSTRAINT organizations_meal_default_price_check CHECK (meal_default_price >= 0);

-- ============================================================
-- meal_records：每生每日一筆
--
-- **訂了沒**與**收不收費**是兩件事（規則 2、3）：
--   ordered    —— 那天到底有沒有訂便當
--   chargeable —— 訂了但要不要收錢。「小孩超過下午 N 點才請假，便當已經送到了」
--                 那種狀況是**人工裁量**，所以這是行政可翻的開關，
--                 **不要自動化 N 點截止邏輯**
--
-- 不訂就不建列也可以，但明確記一筆 `ordered = false` 比「沒有列」好查 ——
-- 「那天到底是沒訂還是沒人處理」是行政真的會問的問題。
-- ============================================================
CREATE TABLE public.meal_records (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  meal_date  date NOT NULL,
  ordered    boolean NOT NULL DEFAULT true,
  chargeable boolean NOT NULL DEFAULT true,
  -- 單價在每一筆上，不是查 org 設定 —— 便當漲價不該改到歷史記錄
  unit_price numeric(10, 0) NOT NULL DEFAULT 0,
  -- **結算標記**：月結時由系統蓋上，蓋過的不會再被撈進下一次月結。
  -- ON DELETE SET NULL：帳單明細被刪掉（作廢）時標記自動解除，那一筆餐費
  -- 下次月結會自動回到待結算 —— 這就是「月結冪等」的機制
  invoice_item_id uuid REFERENCES public.invoice_items(id) ON DELETE SET NULL,
  note       text,
  created_by text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meal_records_unit_price_check CHECK (unit_price >= 0),
  CONSTRAINT meal_records_student_date_unique UNIQUE (student_id, meal_date)
);

CREATE INDEX meal_records_org_date_idx ON public.meal_records (org_id, meal_date);
CREATE INDEX meal_records_student_idx ON public.meal_records (student_id);
-- 月結的查詢入口：這個 org、這段日期、要收費、還沒結算的
CREATE INDEX meal_records_settlement_idx
  ON public.meal_records (org_id, meal_date)
  WHERE invoice_item_id IS NULL AND ordered AND chargeable;

CREATE TRIGGER meal_records_updated_at
  BEFORE UPDATE ON public.meal_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.meal_records ENABLE ROW LEVEL SECURITY;

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
      'invoice','payment_record','session_pack',
      'meal_record','billing_run'
    )
  );
