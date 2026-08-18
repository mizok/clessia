/**
 * 學生名單要不要縮限到某位老師任課的班級。
 *
 * 跟 attendance/teacher-scope.ts 同一個模式：範圍限制放在伺服器、且不看請求怎麼說。
 * 老師沒帶 `taughtByMe` 也一樣縮限 —— 前端隱藏不構成授權（c1）。
 */
export interface StudentScopeInput {
  readonly roles: readonly string[];
  /** 請求的意圖，只是提示；老師的範圍由角色決定，不由這個旗標決定 */
  readonly taughtByMe: boolean;
  readonly ownStaffId: string | null;
}

export type StudentScope = { teacherStaffId: string | null } | { forbidden: true };

export function resolveStudentScope(input: StudentScopeInput): StudentScope {
  if (input.roles.includes('admin')) {
    return { teacherStaffId: null };
  }

  if (input.roles.includes('teacher')) {
    // 沒有 staff 列就無法安全地縮限，放行等於把全校學生交出去
    return input.ownStaffId ? { teacherStaffId: input.ownStaffId } : { forbidden: true };
  }

  return { forbidden: true };
}
