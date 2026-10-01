-- ============================================================
-- 帳單作廢（#898）
--
-- **作廢，不刪除；淨收款歸零才能作廢；作廢不可撤銷**（使用者 2026-09-30 裁定）。
-- 設計全文見 #898 的設計提案留言。
--
-- **為什麼是欄位而不是 status**：`invoices` 沒有 status 欄位，狀態是推導的
-- （`lib/invoice-status.ts`，「能算的不存」）。但「這張被作廢了」不是算出來的，
-- 是一個人在某個時間做的決定 —— 所以它是事實，存欄位。
--
-- **為什麼守在 DB 而不只守在 API**：
-- 1. 寫 `invoice_items` 的不只 `routes/invoices.ts`，還有 `routes/billing-runs.ts` 的
--    餐費異常修補 —— API 層的檢查是「可以忘記呼叫的 helper」。
-- 2. 競態：API 先算淨額、再寫 voided_at，中間插進一筆收款就會作廢一張有錢的帳單。
--    下面的 trigger 讓兩件事互相等待（作廢的 UPDATE 持有 row lock，
--    收款的 trigger 用 FOR SHARE 讀同一列），所以被序列化。
-- API 仍然會先檢查一次 —— 那是為了回一個看得懂的錯誤訊息，不是保護。
--
-- **audit_logs 不用動**：`'invoice'` 已在 resource_type CHECK 內
-- （`20260913101500_audit_logs_subject_organization_resource_types.sql`）。
-- ============================================================

ALTER TABLE public.invoices
  ADD COLUMN voided_at   timestamptz,
  -- ON DELETE SET NULL 跟 created_by 同形狀，所以下面的 CHECK 不能要求它非空
  ADD COLUMN voided_by   text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  ADD COLUMN void_reason text,
  -- 作廢必附理由；沒作廢的帳單不得殘留作廢欄位。
  -- ⚠️ `coalesce` 不能省：`length(btrim(NULL)) > 0` 是 NULL，而 **CHECK 把 NULL 當通過**
  -- —— 少了它，「作廢但沒理由」會被靜靜放行（驗證腳本第一次跑就抓到這個）。
  ADD CONSTRAINT invoices_void_fields CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND length(btrim(coalesce(void_reason, ''))) > 0)
  );

-- ------------------------------------------------------------
-- 1. invoices：作廢後不可再改（含撤銷）；作廢那一刻淨額必須為 0
--
-- 淨額 ≠ 0 一律拒絕，**含負數**（退多了 = 還欠家長錢，作廢會讓那筆欠款從畫面消失）。
-- ------------------------------------------------------------
CREATE FUNCTION public.guard_invoice_void() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_net numeric;
BEGIN
  IF OLD.voided_at IS NOT NULL THEN
    -- 唯一放行：ba_user 被刪時 FK 的 ON DELETE SET NULL 會 UPDATE 到這裡
    -- （created_by / voided_by）。不放行的話，作廢過帳單的人就刪不掉。
    -- 用 jsonb 比對「其餘欄位全都沒變」，將來加欄位也自動被涵蓋。
    IF (NEW.created_by IS NULL OR NEW.created_by = OLD.created_by)
       AND (NEW.voided_by IS NULL OR NEW.voided_by = OLD.voided_by)
       AND to_jsonb(NEW) - 'created_by' - 'voided_by' - 'updated_at'
         = to_jsonb(OLD) - 'created_by' - 'voided_by' - 'updated_at'
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'invoice % is voided and cannot be modified', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.voided_at IS NOT NULL THEN
    SELECT coalesce(sum(CASE WHEN pr.kind = 'refund' THEN -pr.amount ELSE pr.amount END), 0)
      INTO v_net
      FROM public.payment_records pr
     WHERE pr.invoice_id = NEW.id;

    IF v_net <> 0 THEN
      RAISE EXCEPTION 'invoice % has net paid % and cannot be voided', NEW.id, v_net
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER invoices_guard_void
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_void();

-- ------------------------------------------------------------
-- 2. invoice_items / payment_records：父帳單已作廢就不准寫
--
-- DELETE 也擋 —— 刪一筆收款會改變淨額，刪一筆明細會改變作廢當下的總額。
-- **組織被刪時的 CASCADE 不受影響**：級聯刪子列時父列已經不在了，
-- 下面的查詢撈不到它，所以放行。
--
-- FOR SHARE：跟作廢的 UPDATE 互等，見檔頭第 2 點。
-- ------------------------------------------------------------
CREATE FUNCTION public.guard_voided_invoice_children() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_id uuid;
  v_voided_at  timestamptz;
BEGIN
  v_invoice_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;

  SELECT i.voided_at INTO v_voided_at
    FROM public.invoices i
   WHERE i.id = v_invoice_id
     FOR SHARE;

  IF v_voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'invoice % is voided; % on % rejected', v_invoice_id, TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  -- UPDATE 把列搬到另一張已作廢的帳單上也要擋 —— 上面檢查的是 NEW
  IF TG_OP = 'UPDATE' AND OLD.invoice_id <> NEW.invoice_id THEN
    SELECT i.voided_at INTO v_voided_at
      FROM public.invoices i
     WHERE i.id = OLD.invoice_id
       FOR SHARE;

    IF v_voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'invoice % is voided; UPDATE on % rejected', OLD.invoice_id, TG_TABLE_NAME
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER invoice_items_guard_voided
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_voided_invoice_children();

CREATE TRIGGER payment_records_guard_voided
  BEFORE INSERT OR UPDATE OR DELETE ON public.payment_records
  FOR EACH ROW EXECUTE FUNCTION public.guard_voided_invoice_children();
