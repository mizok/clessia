-- ============================================================
-- audit_logs.resource_type 加入 subject / organization（#828）
--
-- **為什麼需要這一支**：科目的三顆寫入鈕與一般設定的「儲存出勤模式」完全沒有
-- audit_logs（#758 第 1 輪逐顆實按查 DB 對照：分校 5 筆、學校 3 筆、科目 0、設定 0）。
-- 而 `logAudit` 是 fire-and-forget（`waitUntilFrom` 包住、失敗只進 console），
-- 所以**不先擴充這個 CHECK 就接線的話，症狀會是「程式看起來接上了、DB 裡還是 0 筆」**
-- —— 跟現在的症狀一模一樣，而且更難查。
--
-- ⚠️ **這個 constraint 的慣例是 DROP + ADD 完整清單，所以「最後執行的那一支說了算」，
-- 而判斷依據是時間戳順序、不是合併順序**（理由與事故見
-- `20260829110000_audit_logs_billing_resource_types.sql` 的檔頭）。
-- 所以這一支的時間戳排在全部既有 migration 之後，內容是**既有 22 個值的完整聯集**
-- 加上新的兩個。撰寫當下（2026-09-13）沒有任何在飛的 PR 動 `supabase/migrations/`
-- （逐支 `gh pr diff --name-only` 查過），所以這份聯集不會清掉別人的值。
--
-- **為什麼是 `organization` 而不是 `org_settings`**：`resource_type` 的既有慣例是
-- 「被動到的實體」＝表名的單數（campus←campuses、school←schools、session←sessions…），
-- 而出勤模式就存在 `organizations` 表裡。用 `organization` 也讓將來「改組織名稱」
-- 這類 audit 不必再加一個值；改到哪個欄位由 `details` 說。
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
      -- #828
      'subject','organization'
    )
  );
