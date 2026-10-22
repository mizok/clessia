import type { SupabaseClient } from '@supabase/supabase-js';
import { inOrg } from './org-scope';

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
 * 會忘記的地方。名字的真相本來就分散在各自的表裡（員工在 staff、家長在 parents）。
 *
 * **#1839 起完全不讀也不寫 `profiles`**（正式 100 列，最後寫入 2026-08-31）：還留著舊列的人
 * 會拿到過時的名字，新人一律拿不到 —— 同一個畫面上「誰操作的」一半對一半錯。
 *
 * 空字串與只有空白視同沒有 —— 有列但欄位空著跟沒有列，對呼叫端是同一件事。
 */
export interface DisplayNameSources {
  staff?: { display_name?: string | null } | null;
  parent?: { name?: string | null } | null;
  baUser?: { name?: string | null } | null;
}

export function resolveDisplayName(sources: DisplayNameSources): string {
  const candidates = [sources.staff?.display_name, sources.parent?.name, sources.baUser?.name];

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
  orgId: string,
  userId: string,
  displayName: string,
): Promise<void> {
  await inOrg(
    supabase.from('staff').update({ display_name: displayName }).eq('user_id', userId),
    orgId,
  );
  await inOrg(supabase.from('parents').update({ name: displayName }).eq('user_id', userId), orgId);
}

/**
 * 任何一位使用者在這個 org 的顯示名稱，**一次查詢**（`ba_user` 嵌 staff／parents，兩邊都有 FK）。
 * 用在「誰操作的」：課務異動流水的 `created_by_name`、稽核的 `user_name`、班級的最後修改者。
 * 讀不到、全是空的、或查詢拋錯都回 `null` —— 那幾個欄位本來就是 nullable，而且業務寫入
 * 已經做完了：名字查失敗不該讓整個請求變成錯誤，也不該讓稽核那一筆跟著寫不進去
 * （原本讀 profiles 時，那支查詢一拋錯，`logAudit` 就整筆放棄）。
 */
export async function loadDisplayName(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<string | null> {
  let data: unknown;
  try {
    ({ data } = await supabase
      .from('ba_user')
      .select('name, staff(display_name, org_id), parents(name, org_id)')
      .eq('id', userId)
      .maybeSingle());
  } catch {
    return null;
  }
  const row = data as {
    name?: string | null;
    staff?: Array<{ display_name: string | null; org_id: string }> | null;
    parents?: Array<{ name: string | null; org_id: string }> | null;
  } | null;
  if (!row) return null;
  return (
    resolveDisplayName({
      staff: row.staff?.find((r) => r.org_id === orgId) ?? null,
      parent: row.parents?.find((r) => r.org_id === orgId) ?? null,
      baUser: row,
    }) || null
  );
}
