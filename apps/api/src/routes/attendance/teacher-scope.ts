/**
 * 課堂列表要不要限制在某位老師的課。
 *
 * 抽成純函式是因為這裡錯的方式很安靜：把 `requested` 直接信任的話，老師只要自己打 API
 * 指定別人的 id 就看得到別人的課，而畫面上完全看不出來 —— 前端隱藏不構成授權（c1）。
 */
export interface TeacherScopeInput {
  readonly roles: readonly string[];
  /** 請求帶來的 teacherId，只有管理員說了算 */
  readonly requested: string | undefined;
  /** 這個使用者自己的 staff.id，沒有對應的 staff 列時是 null */
  readonly ownStaffId: string | null;
}

export type TeacherScope = { teacherId: string | undefined } | { forbidden: true };

export function resolveTeacherScope(input: TeacherScopeInput): TeacherScope {
  if (input.roles.includes('admin')) {
    return { teacherId: input.requested };
  }

  if (input.roles.includes('teacher')) {
    // 沒有 staff 列就無法安全地縮限範圍。這時放行等於把全部課堂交出去，所以拒絕。
    return input.ownStaffId ? { teacherId: input.ownStaffId } : { forbidden: true };
  }

  return { forbidden: true };
}
