-- 移除 classes / schedules / sessions 上僅存的三條殭屍 RLS policy。
--
-- 這三條建於 20260223000001_create_classes.sql，條件同時依賴兩個已經死掉的東西：
--   1. auth.uid() —— Supabase Auth 時代的函式。專案在 20260222000001 改用 Better Auth 之後
--      它永遠回傳 NULL。
--   2. profiles.org_id —— 自動建列的 handle_new_user() 觸發器在同一支 migration 被 DROP，
--      此後只剩 seed.sql 會寫入 profiles，透過 app 建立的使用者在那裡沒有列。
-- 因此它們永遠不會 match 任何人，行為等同其餘 9 張「RLS 啟用、零 policy」的表。
--
-- 刻意**不**關閉 RLS：目前沒有任何非 service-role client（web 端沒有 supabase-js，
-- 全部資料走 Hono API 的 service role key，而 service role 繞過 RLS），所以 RLS 現在碰不到；
-- 但保持啟用且無 policy 是 fail-closed 的 —— 將來若真的接上 anon client，會被全拒而不是全放。
-- 關閉 RLS 反而會讓那個未來的 client 看到所有資料。
--
-- 授權的唯一執行點仍是 Hono middleware 的 org_id 過濾（憲法 c1）。

DROP POLICY IF EXISTS "Users can read classes in own organization" ON public.classes;
DROP POLICY IF EXISTS "Users can read schedules in own organization" ON public.schedules;
DROP POLICY IF EXISTS "Users can read sessions in own organization" ON public.sessions;

-- DROP POLICY IF EXISTS 在名稱打錯時會靜默什麼都不做。這裡明確斷言結果，
-- 讓「名字寫錯」變成 migration 失敗而不是無聲通過。
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT count(*) INTO remaining
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('classes', 'schedules', 'sessions');

  IF remaining <> 0 THEN
    RAISE EXCEPTION
      'classes/schedules/sessions 上仍有 % 條 policy，預期為 0（policy 名稱是否有誤？）',
      remaining;
  END IF;
END $$;
