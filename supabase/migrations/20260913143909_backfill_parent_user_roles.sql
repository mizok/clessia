-- ============================================================
-- 補寫既有家長缺少的 parent 角色（#877）
--
-- **為什麼需要這一支**：`apps/api/src/routes/parents.ts` 全檔沒有任何 `user_roles`
-- 寫入（而 `staff.ts` 有 13 處）—— 兩條建帳號的路，一條插角色一條不插。
-- 所有**從 UI 建立的家長**因此沒有 `parent` 角色，後果是：
--
--   1. `POST /api/login-links` 回 422（`login-links.ts:68` 的 `NO_ROLES`），
--      而 UI 只說「產生失敗／請稍後再試」
--   2. **更嚴重的**：這些帳號就算登入了也過不了 `roleGuard`，**根本進不了家長端**
--
-- 程式碼那一半修在另一支 PR（`insertParentRole()`）。**這一支只補已經建出來的那些**
-- —— 修了程式碼它們也不會自己好。
--
-- **為什麼沒有人早點發現**：seed 的家長角色是 `seed.sql:90` 直接 INSERT 的，
-- 所以「家長有角色」是 seed 的性質、不是產品的 —— 在展示資料上點永遠不會撞到。
--
-- ⚠️ **這一支只新增列，不改也不刪任何既有列。**
-- `where not exists` 讓它冪等：重跑一次是 0 rows，不會覆寫任何人的權限。
-- `permissions` 給 `'[]'` 跟程式碼那一半一致（該欄位只有 admin 在用，
-- `staff.ts:997` 的 teacher 也是 `[]`）。
--
-- 本機執行前的量：`parents` 30 筆，其中 1 筆沒有 parent 角色（`QA-758-R5-匯入家長`）。
-- 正式站的數字查不到（#495），所以這一支寫成「有幾筆就補幾筆」而不是指名補。
-- ============================================================

insert into public.user_roles (user_id, role, permissions)
select p.user_id, 'parent', '[]'::jsonb
from public.parents p
where p.user_id is not null
  and not exists (
    select 1
    from public.user_roles ur
    where ur.user_id = p.user_id
      and ur.role = 'parent'
  );
