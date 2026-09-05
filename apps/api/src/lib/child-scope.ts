/**
 * 一個家長看得到哪些學生。三層授權維度的第三層（org → 分校 → 學生），
 * 形狀照抄 `campus-scope.ts` —— 見 kb/wiki/architecture/parent-data-scope.md。
 */

/**
 * `null` = **不是家長身分**，不受這層限制（跟 `CampusScope` 對管理員的約定一致）。
 *
 * 空陣列 = **是家長，但 `parent_student_relations` 一筆都沒有** —— 什麼都看不到，
 * 不是「不受限」。**這兩者的差別是這層最容易寫錯的地方**：把 `[]` 當成 `null`
 * 處理，等於讓沒綁小孩的家長看到全部。
 */
export type StudentScope = readonly string[] | null;

export interface StudentScopeInput {
  readonly roles: readonly string[];
  /** 這個人在 `parent_student_relations` 裡關聯到的 student id */
  readonly relatedStudentIds: readonly string[];
}

export function resolveStudentScope(input: StudentScopeInput): StudentScope {
  if (!input.roles.includes('parent')) return null;

  return input.relatedStudentIds;
}

/**
 * 家長端「單一孩子」端點（出缺席／成績／繳費）的指名檢查。**必須指名**，
 * 不像 `isCampusAllowed` 那樣「沒指名就放行」——這三支端點的 `childId` 是
 * 必填 query 參數（一次只看一個孩子，不是全部混在一起，見
 * kb/wiki/architecture/parent-read-endpoints.md）。
 *
 * **跟 `isCampusAllowed` 刻意不同的地方**：`scope === null` 在這裡回 `false`，
 * 不是「不受限」。`isCampusAllowed` 的 `null` 代表「這個角色沒有分校限制」是
 * 合法狀態；這裡的 `null` 代表「這個人根本不是家長」，對這三支端點來說
 * 那是異常狀態，fail-closed 是正解，不是放行。
 */
export function isChildAllowed(scope: StudentScope, childId: string): boolean {
  return scope !== null && scope.includes(childId);
}
