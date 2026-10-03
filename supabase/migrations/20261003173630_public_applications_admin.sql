-- ============================================================
-- 公開申請的管理端審核（#1245）：櫃檯備註＋稽核
--
-- - public_applications.staff_note：聯絡紀錄（「10/4 打過電話，週六來試聽」）。
-- - audit_logs.resource_type 加 'public_application'：改狀態、寫備註都記稽核 ——
--   這張表放的是陌生人的個資，誰在什麼時候把它標成 spam 要查得到。
--   清單照慣例整串重宣告，從上一支（20260930075822_audit_logs_announcement_resource_type.sql）加一個值。
--
-- 純加欄＋放寬 CHECK，「套完才部署」：新程式碼會寫這個 resource_type。
-- ============================================================
ALTER TABLE public.public_applications
  ADD COLUMN staff_note text;

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
      'announcement',
      'public_application'
    )
  );
