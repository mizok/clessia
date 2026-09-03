-- 分校資料隔離上線的前置：先補資料，再開開關。
--
-- `staff_campuses` 這張表 2026-02 就存在，但 `authMiddleware` 從來沒有讀它 ——
-- 任何管理員都看得到所有分校的資料。現在 middleware 會依 `staff_campuses` 縮限範圍，
-- 而**沒有被指派任何分校的管理員會什麼都看不到**（fail-closed，刻意的）。
--
-- 既有機構的管理員多半沒有 `staff_campuses` 列，所以直接開開關的話他們隔天登入會看到
-- 一片空白 —— 不是報錯，是空資料，最難診斷的那一種。這支 migration 給每一個既有的
-- 管理員補上 `all_campuses`，讓他們的可見範圍**維持今天的樣子**；之後要縮限，由機構
-- 自己在人員設定裡拿掉這個權限並指派分校。
--
-- **只加 `all_campuses`，不動其他權限。** 有些機構已經把管理員設成受限的權限組合
-- （只是那些設定在 API 層從來沒有生效過），把它們一起覆蓋掉會抹除機構的意圖。
-- 讓那些設定開始生效正是這一刀要的效果。
--
-- 冪等：`permissions` 已經含 `all_campuses` 或 `*` 的列不動。

UPDATE public.user_roles
   SET permissions = COALESCE(permissions, '[]'::jsonb) || '["all_campuses"]'::jsonb
 WHERE role = 'admin'
   AND NOT (COALESCE(permissions, '[]'::jsonb) @> '["all_campuses"]'::jsonb)
   AND NOT (COALESCE(permissions, '[]'::jsonb) @> '["*"]'::jsonb);
