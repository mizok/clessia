-- ============================================================
-- 帳單編號 invoice_no（#1459）：INV-YYMM-NNN，同 org、同開立月（issued_at）流水
--
-- 規則（計畫席 10-10 gate 過）：
--   - YYMM ＝ issued_at（date，台北日期）的年兩碼＋月；NNN 至少三碼，破千變四碼不截斷
--   - 開立那一刻定號；之後改 issued_at 不改號。作廢單保留號碼、不回收（會跳號）
--   - unique (org_id, invoice_no)；null 不參與（舊單回填前）
--
-- 取號：計數表＋單一敘述 upsert（`on conflict do update … returning`）—— 同一列的列鎖讓併發開單排隊，
-- 不撞號、不需要 advisory lock 或重試。BEFORE INSERT trigger 在 invoice_no 為 null 時取號，
-- 所以**所有開單路徑（POST /invoices、billing-runs 批次、之後新增的）自動有號**，api 寫入不用改。
--
-- 舊單：本檔**同一交易**先用既有張數初始化計數表，再建 trigger ⇒ 新單從「既有張數＋1」起算，
-- 1..N 保留給舊單。舊單的實際回填是另一支 after-deploy 檔（只填 null、冪等），本檔不動既有列。
-- `set not null` 不做（計畫席：留使用者裁）。
--
-- ⚠️ api 的 INVOICE_SELECT 讀新欄 → schema 類，**套完才部署**（deploying.md「檔頭要自己核」那一列）。
-- ============================================================

ALTER TABLE public.invoices ADD COLUMN invoice_no text;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_org_invoice_no_key UNIQUE (org_id, invoice_no);

CREATE TABLE public.invoice_no_counters (
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  -- 開立月 YYMM
  period char(4) NOT NULL,
  last_no integer NOT NULL,
  PRIMARY KEY (org_id, period)
);

-- 業務表慣例：啟用 RLS、不給 policy（fail-closed；api 走 service role）
ALTER TABLE public.invoice_no_counters ENABLE ROW LEVEL SECURITY;

-- 1..N 保留給舊單（作廢單也算 —— 回填時一樣給號）
INSERT INTO public.invoice_no_counters (org_id, period, last_no)
SELECT org_id, to_char(issued_at, 'YYMM'), count(*)
FROM public.invoices
GROUP BY org_id, to_char(issued_at, 'YYMM');

CREATE FUNCTION public.assign_invoice_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  yymm char(4);
  n integer;
BEGIN
  IF NEW.invoice_no IS NOT NULL THEN
    RETURN NEW;
  END IF;

  yymm := to_char(NEW.issued_at, 'YYMM');

  INSERT INTO public.invoice_no_counters AS c (org_id, period, last_no)
  VALUES (NEW.org_id, yymm, 1)
  ON CONFLICT (org_id, period) DO UPDATE SET last_no = c.last_no + 1
  RETURNING c.last_no INTO n;

  -- lpad 會截斷超長字串（lpad('1234', 3) = '123'），所以寬度取 max(3, 位數)
  NEW.invoice_no := 'INV-' || yymm || '-' || lpad(n::text, greatest(3, length(n::text)), '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoices_assign_invoice_no
  BEFORE INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_invoice_no();
