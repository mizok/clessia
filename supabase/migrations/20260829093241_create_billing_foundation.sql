-- ============================================================
-- P1 計費地基：billing_mode enum + billing_periods + fee_templates
--
-- 業務規則的真相是 kb/wiki/rules/billing-rules.md，這裡只記 schema 層的取捨。
--
-- **「期」不是 enum。** 受訪公司一年兩期（上學期+暑假／下學期+寒假），但別的機構
-- 可能一年一期或照學期制 —— 寫死成 enum 等於把一家補習班的行事曆刻進 schema。
-- 所以期是 org 自建的具名日期區間（billing_rules 規則 1）。
-- ============================================================

CREATE TYPE public.billing_mode AS ENUM (
  'monthly',      -- 月繳：每月一張帳單
  'period',       -- 期繳：機構自訂的具名日期區間（billing_periods）
  'session_pack'  -- 堂數制：買 N 堂慢慢上完
);

-- ============================================================
-- billing_periods：機構自訂的收費期間
--
-- **org 層不是校區層**：期間是機構的行事曆，分校不會各自定義學期。
-- 刻意不加「不得重疊」的約束 —— 過渡期間（如舊制最後一期與新制第一期）重疊是
-- 真實情境，而擋掉它只會讓行政去改日期硬湊。
-- ============================================================
CREATE TABLE public.billing_periods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_periods_dates_check CHECK (end_date >= start_date)
);

CREATE INDEX billing_periods_org_id_idx ON public.billing_periods (org_id);
-- 列表一律「這個組織的期間、依開始日倒序」
CREATE INDEX billing_periods_org_start_idx ON public.billing_periods (org_id, start_date DESC);
-- 同一組織不得有同名期間 —— 開帳時行政是用名字認它的
CREATE UNIQUE INDEX billing_periods_org_name_unique ON public.billing_periods (org_id, name);

CREATE TRIGGER billing_periods_updated_at
  BEFORE UPDATE ON public.billing_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- fee_templates：org 層價目表
--
-- **只給定價，不給折扣。** billing_rules 規則 2：折數看老闆當下心情、每個客人可能
-- 不一樣 —— 現實裡不存在結構化的折扣規則，只存在議價。所以這裡沒有任何 discount
-- 欄位，實際談定的金額存在 enrollments.agreed_amount，帳單再各自存實收與調整原因。
--
-- amount 是 numeric(10,0)：台幣沒有小數，用整數存避免「1000.00 vs 1000.0」的比對問題。
-- 上限 10 位數（約 99 億）對補習班單筆費用綽綽有餘。
-- ============================================================
CREATE TABLE public.fee_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name         text NOT NULL,
  billing_mode public.billing_mode NOT NULL,
  amount       numeric(10, 0) NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fee_templates_amount_check CHECK (amount >= 0)
);

CREATE INDEX fee_templates_org_id_idx ON public.fee_templates (org_id);
-- 報名時挑選：只看這個組織還在用的
CREATE INDEX fee_templates_org_active_idx ON public.fee_templates (org_id, is_active);
CREATE UNIQUE INDEX fee_templates_org_name_unique ON public.fee_templates (org_id, name);

CREATE TRIGGER fee_templates_updated_at
  BEFORE UPDATE ON public.fee_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 業務表一律啟用 RLS 但不建 policy：service role 會繞過它，授權真正發生在
-- Hono middleware（c1）。這是 fail-closed 後盾 —— 將來若真的接上 anon client，
-- 會被全拒而不是全放。
--
-- 這一段不是樣板：後期新增的表曾經整批漏掉（見 kb/wiki/lessons/rls-backstop-drift），
-- 現在由 harness gate A8 守著。
-- ============================================================
ALTER TABLE public.billing_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_templates ENABLE ROW LEVEL SECURITY;

-- audit_logs 的 resource_type 清單**不在這支**動 —— 見
-- 20260829110000_audit_logs_billing_resource_types.sql。理由寫在那支的檔頭：
-- B 軌（聯絡簿／教務日誌）的 migration 時間戳比這支晚，會覆蓋這裡設的清單。
