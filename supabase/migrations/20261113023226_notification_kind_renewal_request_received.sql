-- ============================================================
-- 管理員通知種類：家長送出續課異動申請（#1122）
--
--   renewal_request_received  管理員（manage_students，gate Q6 (a)）：處理入口在 /admin/applications
--
-- 純加列舉值，「套完才部署」或「部署完才套」都安全：舊程式碼不會寫這個值。
-- ADD VALUE 不能跟「使用這個新值」放在同一個交易（20260906083827）—— 這支只加值、不用它。
-- ============================================================
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'renewal_request_received';
