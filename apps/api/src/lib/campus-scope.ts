import { hasPermission } from './permissions';

/**
 * 一個使用者看得到哪些分校。
 *
 * **`org_id` 之所以可信，是因為它沒有例外（憲法 c1）。分校要的是同一種待遇。**
 * 在單一功能裡自己做一層分校過濾，會得到一個守得住的畫面和其餘全部守不住的畫面，
 * 而使用者無從分辨哪些是哪些 —— 那比全都不守更糟，它讓人相信系統有隔離。
 *
 * 見 kb/wiki/architecture/authorization-scope.md 洞 5。
 */

/**
 * `null` = **不受分校限制**，兩種來源：
 *
 * - 管理員有 `all_campuses`（或 `*`）—— 真的跨分校
 * - 不是管理員 —— 老師由 teacher-scope 限制（只碰自己任課的班，那比分校更窄），
 *   家長由自己的孩子限制。**對他們套分校範圍沒有增加安全性，只會把沒有
 *   `staff_campuses` 列的老師整個鎖死。**
 *
 * 空陣列 = 這個管理員一個分校都沒被指派 → 看不到任何東西（fail-closed）。
 */
export type CampusScope = readonly string[] | null;

export interface CampusScopeInput {
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  /** 這個人在 `staff_campuses` 裡的分校 id */
  readonly assignedCampusIds: readonly string[];
}

export function resolveCampusScope(input: CampusScopeInput): CampusScope {
  if (!input.roles.includes('admin')) return null;
  if (hasPermission(input.permissions, 'all_campuses')) return null;

  return input.assignedCampusIds;
}

/**
 * 請求指名某個分校時，它在不在允許範圍內。
 *
 * **不在就要 403，不是默默回空陣列** —— 默默回空會讓越權嘗試看起來像
 * 「那個分校那天沒有人」，越權的人不知道自己被擋，被越權的人也不會發現。
 */
export function isCampusAllowed(scope: CampusScope, campusId: string | undefined | null): boolean {
  if (!campusId) return true;
  if (scope === null) return true;

  return scope.includes(campusId);
}

/**
 * 這次查詢實際要用的分校清單。
 *
 * - 沒有範圍限制且請求沒指定 → `null`（不加條件）
 * - 請求指定了、而且落在範圍內 → 就那一個（縮小，正常路徑）
 * - 有範圍限制、請求沒指定 → 他被指派的全部
 * - **請求指定了範圍外的分校 → 空清單**（見下）
 *
 * ## 兩層防線的分工：守衛負責大聲，這裡負責保底
 *
 * **越權指名的正常結局是 403，不是這裡的空清單。** 那道 403 由
 * `middleware/auth.ts` 的 `campusRequestGuard` 給，理由寫在 `isCampusAllowed`
 * 的檔頭：默默回空會讓越權嘗試看起來像「那個分校那天沒有人」，越權的人不知道
 * 自己被擋，被越權的人也不會發現。**那個立場沒有改變。**
 *
 * 但那道守衛是**白名單**：它列舉參數名（`campusId` / `campus_id` / 複數版），
 * 而白名單擋不住還沒被列舉的名字 —— 2026-09-06 的 `academy-exams` 就是這樣漏的
 * （它的參數叫 snake_case 的 `campus_id`，而守衛當時只認 camelCase）。
 *
 * 所以這裡取**交集**而不是讓 `requested` 覆蓋 `scope`：**萬一將來又有一個沒被
 * 列舉的名字漏進來，最壞情況是拿不到別人的資料，而不是拿得到。**
 *
 * > **走到空清單這條路本身是一個 bug 的徵兆** —— 它代表有一個載體繞過了守衛。
 * > 使用者看到的「查無資料」不是這裡的設計意圖，是兜底啟動了。
 *
 * 空清單會讓呼叫端下出 `.in(col, [])`。**那確實是零筆，不是「沒有條件」**
 * ——本機 PostgREST 實測（2026-09-06）：
 *
 * ```
 * GET /rest/v1/campuses?select=id           → Content-Range: 0-10/11
 * GET /rest/v1/campuses?select=id&id=in.()  → 200, Content-Range: * /0, body []
 * supabase-js .in('id', [])                 → count 0, error none
 * ```
 *
 * 這個前提原本只有設計註解、沒有量測，而**「一個分校都沒被指派」的 fail-closed
 * 從第一天就靠它**。
 */
export function campusFilterIds(
  scope: CampusScope,
  requested: string | undefined | null,
): readonly string[] | null {
  if (!requested) return scope;
  // 不受分校限制的管理員指定單一分校 —— 這是正常的篩選，不是縮限。
  //
  // **`== null` 是刻意的鬆比較**：型別上 `CampusScope` 是 `readonly string[] | null`，
  // 但 context 沒有掛 `authMiddleware` 時 `c.get('campusScope')` 會是 `undefined`
  //（測試裡的精簡 app 就是這樣）。舊版的 `if (requested) return [requested]` 根本沒碰
  // `scope`，所以那個情況一直被當成「不受限」；這裡維持同樣的行為，**不趁機改語意** ——
  // 「context 沒有 campusScope 時該不該 fail-closed」是另一個問題，見 #503 系列的回報。
  if (scope == null) return [requested];

  // 交集：指名只能縮小範圍，撐不大它
  return scope.includes(requested) ? [requested] : [];
}

/**
 * 把分校範圍套到一個查詢上。**各路由的呼叫端只有一行，因為漏掉一行就是一個洞。**
 *
 * `column` 各路由不同（`campus_id` / `classes.campus_id` / `events.campus_id`），
 * 所以由呼叫端給 —— 那是這支 helper 唯一需要判斷的地方，其餘（要不要加條件、
 * 加哪些 id）一律在這裡決定。
 *
 * 呼叫端**不必先驗 `requested` 合不合法** —— 全域的 `campusRequestGuard` 已經擋掉
 * 範圍外的指名（403）。這裡拿到的 `requested` 一定是允許的。
 */
export function applyCampusFilter<T extends { in(column: string, values: string[]): T }>(
  query: T,
  column: string,
  scope: CampusScope,
  requested?: string | null,
): T {
  const ids = campusFilterIds(scope, requested);

  return ids ? query.in(column, [...ids]) : query;
}
