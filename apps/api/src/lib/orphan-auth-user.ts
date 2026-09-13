import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 一個 `ba_user` 是不是「完全脫離的孤兒」。
 *
 * ## 這個判準為什麼必須存在
 *
 * `ba_user.email` 有 UNIQUE 索引，而 `ba_*` 表**可讀不可寫**（憲法 c2）——
 * 所以一旦某個 email 的 `ba_user` 失去了所有關聯，那個 email 就**永久不能再用**，
 * 而 app 裡沒有任何東西清得掉它（`auth.api.removeUser` 在這個專案必定 403，
 * 理由寫在 `routes/staff.ts` 的 DELETE handler）。
 *
 * 孤兒有兩個來源，兩個都量到過：
 *
 * 1. `DELETE /api/staff/{id}`（#833 已改成拒絕）
 * 2. **`POST /api/staff` 中途失敗時的 `rollbackCreatedUser()`** ——
 *    它呼叫的是同一支 403 的 `removeUser`，catch 訊息逐字寫著「孤兒 ba_user=」
 *
 * 所以第 2 條還會繼續產生孤兒（它的失敗模式改不掉，除非擴 Better Auth 的權限），
 * **而這支判準讓那些孤兒可以被接管回來**。
 *
 * ## 三者皆空才算孤兒
 *
 * | 掛著什麼 | 意思 |
 * | -------- | ---- |
 * | `staff` | 在職或已封存的人員 —— **不是孤兒**，接管會把兩個人混成一個帳號 |
 * | `parents` | 家長帳號 —— **不是孤兒**，接管等於把家長變成員工 |
 * | `user_roles` | 還有角色 —— **不是孤兒**，即使 staff 那一列不見了 |
 *
 * **三張表都空才接管。** 少查任何一張的後果都是「把別人的帳號接過來」，
 * 而那在畫面上看起來完全正常（名字會被改成新人員的名字）。
 */
export async function isOrphanAuthUser(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const [staff, parents, roles] = await Promise.all([
    supabase.from('staff').select('id').eq('user_id', userId),
    supabase.from('parents').select('id').eq('user_id', userId),
    supabase.from('user_roles').select('role').eq('user_id', userId),
  ]);

  // **查詢失敗一律當成「不是孤兒」（fail closed）** ——
  // 不確定它掛著什麼的時候接管，就是有可能接管別人的帳號。
  if (staff.error || parents.error || roles.error) return false;

  return (
    (staff.data ?? []).length === 0 &&
    (parents.data ?? []).length === 0 &&
    (roles.data ?? []).length === 0
  );
}
