import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 一個人的顯示名稱該從哪裡來。
 *
 * **`profiles` 不是可靠的來源。** 原本自動建列的 `handle_new_user()` 觸發器在 Better Auth
 * 遷移（20260222000001）時被 DROP，之後沒有替代品 —— 而 `staff.ts` / `parents.ts` 的建立
 * 路徑寫的是 ba_user + staff/parents + user_roles，**沒有人寫 profiles**。結果是任何透過
 * app 建立的使用者都沒有 profiles 列，`bootstrap-org.ts` 建的第一個管理員也一樣，
 * 於是 `/api/me` 的 displayName 一律是空字串，header 只剩 email。
 *
 * 修法刻意**不是**「到處補 profiles 列」—— 那是跟殭屍賽跑，每多一條建立路徑就多一個
 * 會忘記的地方。改成往下找：名字的真相本來就分散在各自的表裡（員工在 staff、家長在
 * parents），`profiles` 只是還沒清掉的舊來源。
 *
 * 空字串與只有空白視同沒有 —— 有列但欄位空著跟沒有列，對呼叫端是同一件事。
 */
export interface DisplayNameSources {
  profile?: { display_name?: string | null } | null;
  staff?: { display_name?: string | null } | null;
  parent?: { name?: string | null } | null;
  baUser?: { name?: string | null } | null;
}

export function resolveDisplayName(sources: DisplayNameSources): string {
  const candidates = [
    sources.profile?.display_name,
    sources.staff?.display_name,
    sources.parent?.name,
    sources.baUser?.name,
  ];

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }

  return '';
}

/**
 * 把新的顯示名稱寫回去 —— **寫進每一個 `resolveDisplayName` 可能讀到的地方**。
 *
 * 原本只寫 `profiles`，而多數使用者根本沒有 profiles 列（見上），所以那個 update 匹配
 * 0 列、靜靜地什麼都沒做：改完名字存了等於沒存，回讀又走 fallback 拿到舊值 ——
 * 看起來像讀的 bug。讀是 fallback 鏈，寫就得是全部寫，兩邊才會一致。
 *
 * 不做「先查有沒有列再決定寫哪張」的分支：沒有對應列的 update 本來就是 no-op，
 * 多一次查詢換一堆分支不划算。同一個人同時是員工與家長時兩處都更新，那是刻意的 ——
 * 兩個身分本來就該顯示同一個名字。
 *
 * **不寫 `ba_user.name`** —— `ba_*` 由 Better Auth 獨佔寫入（c2）。
 */
export async function updateDisplayName(
  supabase: SupabaseClient,
  userId: string,
  displayName: string,
): Promise<void> {
  await supabase.from('profiles').update({ display_name: displayName }).eq('id', userId);
  await supabase.from('staff').update({ display_name: displayName }).eq('user_id', userId);
  await supabase.from('parents').update({ name: displayName }).eq('user_id', userId);
}
