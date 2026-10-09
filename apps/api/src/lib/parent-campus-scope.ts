import type { SupabaseClient } from '@supabase/supabase-js';

import { campusFilterIds, type CampusScope } from './campus-scope';

/**
 * 家長的分校範圍。**判準只有一份，住在這裡。**
 *
 * 家長身上沒有 `campus_id` —— 分校歸屬由**報名**決定（`AGENTS.md`：學生分校來自
 * enrollments），所以範圍要走三跳：
 *
 * ```
 * parent_student_relations → students → enrollments → classes.campus_id（三層 !inner，條件下在最底層）
 * ```
 *
 * 判準：**分校管理員看得到的家長 = 孩子在他的分校有報名的家長。**
 * 孩子跨分校時任一分校的管理員都看得到那位家長 —— 不做「只看得到自己分校那半的孩子」
 * 的細切（#816 的裁定）。
 *
 * ## 為什麼抽出來（#821）
 *
 * #816 把這段內嵌在 `GET /api/parents` 裡。其餘 8 個端點也要同一個範圍，
 * 而**在 9 個地方各寫一次就是 9 個會分岔的判準** —— #815 的成因逐字是這個形狀：
 * 兩處各自推論同一件事，在某個輸入上分岔。
 */

/** ponytail: O(範圍內關聯列) 每次呼叫；量大時升級成 RPC／view（migration） */
const PAGE = 1000;

/**
 * 這個請求看得到哪些家長的 id。
 *
 * - `null` = **不受分校限制**（跨分校的管理員；或非 admin —— 他們由更窄的範圍把關）
 * - `[]` = 範圍內一個家長都沒有。**空清單也是條件** ——
 *   `.in(col, [])` 實測是零筆而不是「沒有條件」（量測紀錄在 `campus-scope.ts`）
 */
export async function resolveScopedParentIds(
  supabase: SupabaseClient,
  scope: CampusScope,
): Promise<string[] | null> {
  const campusIds = campusFilterIds(scope, undefined);
  if (!campusIds) return null;

  // ⚠️ **三層 `!inner` 是寫死的，不跟任何條件連動。** PostgREST 的巢狀過濾走 left join，
  // 條件不成立的子列不會把父列排除、只會把關聯變成 null 留著。#815 就是因為 `!inner`
  // 跟著「使用者有沒有傳 campusId」走、而條件跟著 scope 走，兩邊分岔。
  // **這裡沒有第二個判準可以分岔。** 三層都 inner，條件才會一路往上傳到關聯列。
  //
  // 從關聯表出發（#1374）：一列＝一條關聯，不是一筆報名。原本先撈報名（破千被 `max_rows`
  // 靜默截斷）、再把學生 id 整串塞進 `.in()`（同樣截斷，學生一多還會撞 URL 長度）。
  // 撈到底：每頁 1000（= `max_rows`），照 id 翻到不足一頁為止。
  const parentIds = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('parent_student_relations')
      .select('id, parent_id, students!inner(enrollments!inner(classes!inner(campus_id)))')
      .in('students.enrollments.classes.campus_id', [...campusIds])
      .order('id')
      .range(from, from + PAGE - 1);
    // 「查詢失敗」不能長得像「範圍內沒有家長」—— 後者在單筆端點是 403、在匯入是「同名家長不能合併」。
    // 丟出去由全域 onError 回 500（呼叫端 9 處都沒接 error）
    if (error) throw new Error(`resolveScopedParentIds failed: ${error.message}`);
    for (const row of (data ?? []) as Array<{ parent_id: string | null }>) {
      if (row.parent_id) parentIds.add(row.parent_id);
    }
    if ((data ?? []).length < PAGE) break;
  }

  return [...parentIds];
}

/**
 * 這位家長在不在這個請求的範圍內。**越權的正常結局是 403**，
 * 跟既有的 `campusRequestGuard` 一致（`isCampusAllowed` 檔頭：默默回空會讓越權嘗試
 * 看起來像「那個分校那天沒有人」）。
 *
 * ⚠️ **一個範圍內沒有任何報名的家長會回 `false`** —— 包含「剛剛才被建立、
 * 孩子還沒報名」的那種。那不是這支函式的缺陷，是**分校歸屬由報名決定**的必然結果；
 * 受限管理員建得出家長，而在有報名之前他自己也看不到。見 #821 的說明。
 *
 * ponytail: 走 `resolveScopedParentIds` 再 `includes`，多兩支查詢換「判準只有一份」。
 * 反向查（從 `parentId` 往回找它孩子的報名分校）更省，但**那是第二個實作**，
 * 而 #815 的教訓是兩個判準必分岔。要優化就把兩支都改成問同一個 SQL view。
 */
export async function isParentWithinScope(
  supabase: SupabaseClient,
  scope: CampusScope,
  parentId: string,
): Promise<boolean> {
  const scopedParentIds = await resolveScopedParentIds(supabase, scope);

  return scopedParentIds === null || scopedParentIds.includes(parentId);
}
