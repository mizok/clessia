-- ============================================================
-- 學年升級前提醒的通知種類（#1820 第三張，設計稿 kb/wiki/specs/admin/system/grade-promotion.md §2）
--
--   grade_promotion_reminder  管理員（manage_students＋all_campuses）：升級日前 N 天提醒到設定預覽並執行
--
-- 跟 #1693 的管理員摘要同一條管道：不推播，只進通知中心。
-- 純加列舉值，「套完才部署」或「部署完才套」都安全：舊程式碼不會寫這個值。
-- ADD VALUE 不能跟「使用這個新值」放在同一個交易（20260906083827）—— 這支只加值、不用它。
-- ============================================================
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'grade_promotion_reminder';
