-- ============================================================
-- contact_book_entries.teacher_edited_at：老師／管理員最後改內容的時間（#2080-3）
--
-- 列表要顯示「游佩珊 16:52 編輯」（A6 contact-book `.ent__ed`）。不能拿 updated_at：
-- 家長簽收也是一次 UPDATE，trigger 會把 updated_at 跳成簽收時間（使用者 11-02 裁定 (a)）。
--
-- 只由 PUT /api/contact-book 的 upsert 寫（內容沒變不寫，同 updated_at 的規則）；
-- 簽收端點不碰它。nullable：舊資料由另一支 after-deploy 的 backfill 補。
-- ============================================================
ALTER TABLE public.contact_book_entries
  ADD COLUMN teacher_edited_at timestamptz;

COMMENT ON COLUMN public.contact_book_entries.teacher_edited_at IS
  '老師／管理員最後修改內容的時間；家長簽收不動它（#2080-3）';
