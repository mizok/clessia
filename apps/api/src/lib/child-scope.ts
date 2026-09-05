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
