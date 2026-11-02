-- clessia:apply after-deploy
-- ============================================================
-- 回填 contact_book_entries.teacher_edited_at（#2080-3）—— 部署完由使用者 dispatch migrate（deploying.md）
--
-- schema 在 20261102141721_contact_book_teacher_edited_at.sql；這支只補資料。
-- 簽收與老師寫入都會跳 updated_at（簽收時 signed_at 與 updated_at 是同一個交易的 now()，相等）：
--   - 沒簽，或 updated_at > signed_at → 最後一次 UPDATE 是老師改的，取 updated_at
--   - 否則最後一次 UPDATE 是簽收，老師時間已經被蓋掉 → 退回 created_at（第一次寫的時間）
-- 只補 NULL：部署後老師寫的列已經有值，不會被蓋；重跑零列變動。
--
-- ⚠️ 這句 UPDATE 本身會讓 `contact_book_entries_updated_at` 把 updated_at 推到回填當下 ——
-- 那每一則已簽收的都會變成 updated_at > signed_at，全部誤標「簽收後有修改」。
-- 所以**只在這一句前後**關掉它、同一交易內再開回來（同 20261010021232_invoice_no_backfill.sql；
-- migration 一支檔＝一個交易，中途失敗整支回滾，trigger 不會停在關閉狀態）。
-- ============================================================

ALTER TABLE public.contact_book_entries DISABLE TRIGGER contact_book_entries_updated_at;

UPDATE public.contact_book_entries
SET teacher_edited_at = CASE
  WHEN signed_at IS NULL OR updated_at > signed_at THEN updated_at
  ELSE created_at
END
WHERE teacher_edited_at IS NULL;

ALTER TABLE public.contact_book_entries ENABLE TRIGGER contact_book_entries_updated_at;
