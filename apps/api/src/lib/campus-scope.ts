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
 * 清單版的 `isCampusAllowed` —— 指派多個分校時（`staff.campusIds`）每一個都要在範圍內。
 *
 * **一個都不能超出**：只要有一個範圍外的就整批拒絕，不是默默過濾掉它。默默過濾會讓
 * 呼叫端以為指派成功了，而少掉的那個分校沒有人會發現。
 */
export function campusIdsWithinScope(
  scope: CampusScope,
  campusIds: readonly string[] | undefined | null,
): boolean {
  if (!campusIds) return true;

  return campusIds.every((campusId) => isCampusAllowed(scope, campusId));
}

/**
 * 這次查詢實際要用的分校清單。
 *
 * - 沒有範圍限制且請求沒指定 → `null`（不加條件）
 * - 請求指定了（且已經通過 `isCampusAllowed`）→ 就那一個
 * - 有範圍限制、請求沒指定 → 他被指派的全部
 */
export function campusFilterIds(
  scope: CampusScope,
  requested: string | undefined | null,
): readonly string[] | null {
  if (requested) return [requested];

  return scope;
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
