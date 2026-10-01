-- ============================================================
-- audit_logs.resource_type 加入 announcement（#911）
--
-- **為什麼需要這一支**：公告的「發佈」是會送到所有老師或家長眼前的動作，卻完全沒有
-- audit_logs（`routes/announcements.ts` 的 `logAudit` 數是 0）。而 `logAudit` 是
-- fire-and-forget，所以**不先擴充這個 CHECK 就接線的話，症狀會是「程式看起來接上了、
-- DB 裡還是 0 筆」**（#828 同一個形狀）。
--
-- **只有發佈會用到這個值。** 「標記已讀」與「全部已讀」刻意不記（使用者 2026-09-30 裁定）：
-- `announcement_reads` 本身就存了誰、哪一則、何時**第一次**讀（upsert 不覆寫 read_at），
-- 而且永久保存；audit_logs 90 天就被 cron 清掉，放進去只會把管理異動淹掉。
--
-- ⚠️ **這個 constraint 的慣例是 DROP + ADD 完整清單，所以「最後執行的那一支說了算」，
-- 而判斷依據是時間戳順序、不是合併順序**（理由與事故見
-- `20260829110000_audit_logs_billing_resource_types.sql` 的檔頭）。
-- 這一支的時間戳排在全部既有 migration 之後，內容是**既有 24 個值的完整聯集**
-- 加上 `announcement`。撰寫當下（2026-09-30）在飛的 PR 裡只有 #921
-- （`20260930072356_invoice_void.sql`）動 `supabase/migrations/`，它不碰 audit_logs，
-- 所以這份聯集不會清掉別人的值。
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
      'meal_record','billing_run',
      'subject','organization',
      -- #911
      'announcement'
    )
  );
