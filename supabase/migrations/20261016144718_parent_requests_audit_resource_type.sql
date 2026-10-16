-- #1707：管理端處理家長登入後送的報名／試聽申請（/api/parent-requests），改狀態要寫稽核。
-- audit_logs.resource_type 的 CHECK 加 'enrollment_request'、'trial_request'。
-- 只加值，既有的值照抄 20261004054133_public_applications_admin.sql（那是目前最後一版）。

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
      'public_application',
      'enrollment_request','trial_request'
    )
  );
