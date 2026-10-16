-- ============================================================
-- 老師與管理員的通知種類（#1693；使用者更正 #1626 Q7：「老師跟行政可以先沒有推播，
-- 但是他們不能沒有通知」—— 不推播，只進通知中心）
--
-- 第一版種類（使用者勾選，計畫席 gate 過）：
--   application_received  管理員：新的試聽／報名申請（公開表單與家長登入後送的都算，Q2）
--   overdue_digest        管理員（manage_finance）：每日逾期帳單摘要
--   unbilled_reminder     管理員（manage_finance）：待開單提醒
--   schedule_change       老師：自己的課有異動（停課、代課、調課、換任課老師、復課，Q3）
--   leave_for_my_class    老師：有學生請了自己的課（目前掛在管理員代請假上，Q1）
--
-- **刻意不加「家長送出請假」**：目前沒有家長送請假的路由（Q1，計畫席在問使用者要不要做），
-- 加了就是一個永遠不會出現的值（announcements 的 audience 同型教訓）。那個功能開了再加一支。
--
-- 純加列舉值，「套完才部署」或「部署完才套」都安全：舊程式碼不會寫這些值。
-- ADD VALUE 不能跟「使用這個新值」放在同一個交易（`unsafe use of new value`，20260906083827）——
-- 這支只加值、不用它。
-- ============================================================
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'application_received';
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'overdue_digest';
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'unbilled_reminder';
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'schedule_change';
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'leave_for_my_class';
