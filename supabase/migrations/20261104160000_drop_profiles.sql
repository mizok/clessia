-- #1839：drop 已經沒有人讀寫的 public.profiles（使用者 11-04 裁定做）。
--
-- 為什麼可以 drop：
-- - API 沒有任何讀寫路徑：#1841 把讀的地方全改走 lib/display-name.ts（同 org staff → parents → ba_user），
--   兩處 update 也拿掉了。`git grep -n "from('profiles')\|public.profiles" -- apps packages tools` 零命中。
-- - 資料庫層沒有依賴：沒有任何 FK 指向它、沒有 view／函式／RLS policy 用到它（本機 pg_constraint、
--   pg_depend、pg_proc.prosrc、pg_policies 都查過）。它自己的 FK（→ ba_user、→ organizations）與
--   updated_at 觸發器會跟著表一起消失。
-- - 正式 100 列，最後寫入 2026-08-31（計畫席 10-22 對過正式 DB），內容是舊的顯示名稱，現在沒有人讀。
--
-- 刻意不加 CASCADE：萬一有沒查到的依賴，讓 migration 失敗，而不是連帶刪掉別的東西。
-- seed.sql 同一張 PR 拿掉了寫 profiles 的四段，否則 db:reset 會整批失敗（#838 那種空庫）。

DROP TABLE IF EXISTS public.profiles;
