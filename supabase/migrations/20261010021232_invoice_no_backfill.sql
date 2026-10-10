-- clessia:apply after-deploy
-- ============================================================
-- 舊單回填 invoice_no（#1459）—— 部署完由使用者 dispatch migrate（deploying.md）
--
-- 前一支 `20261010020730_invoice_no.sql` 在同一交易裡用既有張數初始化了計數表，所以每個
-- (org, 開立月) 的 1..N 是保留給舊單的；trigger 替之後的新單從 N+1 起算。這支把那 N 張填上：
--   - 只動 `invoice_no IS NULL` 的列 —— trigger 上線後所有新單都有號，null 只會是舊單
--   - 同 org 同月依 issued_at, created_at, id 排序給 1..N（作廢單也給號：收據上可能印過）
--   - **冪等**：再跑一次沒有 null 可填，零列變動
--
-- 兜底：`unique (org_id, invoice_no)` 讓任何撞號整支失敗回滾（不會半套）。正常不會撞 ——
-- 撞號只可能來自「部署到回填之間有舊單的 issued_at 被改到別的月份」，而目前沒有任何 api 改得到 issued_at。
-- 最後把計數表抬到至少已用的最大號，防同一種邊界讓下一張新單撞號。
--
-- ⚠️ 作廢單：`invoices_guard_void`（20260930072356_invoice_void.sql）拒絕對作廢單做
-- created_by／voided_by／updated_at 以外的任何 UPDATE（它用 jsonb 比對，刻意涵蓋將來的新欄）。
-- 回填要替作廢單也給號，所以**只在這一句 UPDATE 前後**關掉它、同一交易內再開回來
-- （migration 一支檔＝一個交易；中途失敗整支回滾，trigger 不會停在關閉狀態）。
-- 副作用：`invoices_updated_at` 會把被回填列的 updated_at 推到回填當下（含作廢單）。
-- ============================================================

ALTER TABLE public.invoices DISABLE TRIGGER invoices_guard_void;

WITH numbered AS (
  SELECT
    id,
    org_id,
    to_char(issued_at, 'YYMM') AS yymm,
    row_number() OVER (
      PARTITION BY org_id, to_char(issued_at, 'YYMM')
      ORDER BY issued_at, created_at, id
    ) AS n
  FROM public.invoices
  WHERE invoice_no IS NULL
)
UPDATE public.invoices AS i
SET invoice_no = 'INV-' || numbered.yymm || '-' || lpad(numbered.n::text, greatest(3, length(numbered.n::text)), '0')
FROM numbered
WHERE i.id = numbered.id;

ALTER TABLE public.invoices ENABLE TRIGGER invoices_guard_void;

-- 計數表不得低於已用的最大號（`INV-YYMM-` 之後的數字）
INSERT INTO public.invoice_no_counters AS c (org_id, period, last_no)
SELECT org_id, substr(invoice_no, 5, 4), max(substr(invoice_no, 10)::integer)
FROM public.invoices
WHERE invoice_no ~ '^INV-[0-9]{4}-[0-9]+$'
GROUP BY org_id, substr(invoice_no, 5, 4)
ON CONFLICT (org_id, period) DO UPDATE SET last_no = greatest(c.last_no, excluded.last_no);
