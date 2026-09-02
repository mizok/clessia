-- ============================================================
-- profiles.id 從 uuid 改成 text
--
-- 這一欄存的是**使用者 id**，也就是 `ba_user.id`（text）。Better Auth 產的是
-- nanoid（`9BA9xORJp2YFQnWau6J8NmNC6641K41F`），塞不進 uuid 欄位：
--
--   ERROR: invalid input syntax for type uuid: "9BA9xORJp2YFQnWau6J8NmNC6641K41F"
--
-- **seed 的使用者 id 剛好都是 uuid 形狀的字串，所以本機從來不會炸** ——
-- 第一個真實的 LINE 帳號才踩到（人員管理改角色時，同一支 PATCH 會順便更新
-- profiles.display_name）。這是「測試資料的形狀比正式資料窄」的典型：
-- 型別錯了很久沒人發現，因為沒有一筆資料能證明它錯。
--
-- 其他 26 個存 `ba_user.id` 的欄位（`staff.user_id`、`user_roles.user_id`、
-- `audit_logs.user_id`、各種 `created_by` / `recorded_by`…）全部都是 text 且有外鍵。
-- **`profiles.id` 是唯一的例外**：它從 `auth.users`（uuid）那個時代留下來，
-- 換成 Better Auth 之後沒跟著改。
--
-- 一併補上外鍵，跟 `staff.user_id` / `user_roles.user_id` 同一個規則
-- （ON DELETE CASCADE）—— 型別對了但沒有約束的話，下一次還是會漂走。
--
-- 沒有任何外鍵指向 `profiles.id`，所以改型別不會牽動別的表。
-- 既有資料用 `id::text` 轉換：uuid 轉出來是小寫加連字號，跟 `ba_user.id`
-- 存的形式一致。
-- ============================================================

ALTER TABLE public.profiles
  ALTER COLUMN id TYPE text USING id::text;

-- 孤兒列（對不到 ba_user 的）會擋住外鍵。先清掉 —— profiles 只存顯示名，
-- 對不到帳號的那些本來就沒有用途，而且沒有任何表參照它。
DELETE FROM public.profiles p
 WHERE NOT EXISTS (SELECT 1 FROM public.ba_user u WHERE u.id = p.id);

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES public.ba_user(id) ON DELETE CASCADE;
