import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 老師能不能對這一堂課寫出勤。
 *
 * **範圍限制原本只擋讀不擋寫。** `/api/attendance/sessions` 的清單會用
 * `resolveTeacherScope` 縮到自己的課，但記錄／批次／更新三支寫入端點只檢查
 * **時窗**（`assertAttendanceWindow`）—— 老師在畫面上看不到別班，可是清單本來就
 * 回傳 `eventId`，換一個值就改得動別班的出勤。
 * 見 kb/wiki/architecture/authorization-scope.md 洞 4。
 *
 * **寫入含代課，讀取不含 —— 這是刻意的不對稱，不是漏掉。**
 * 讀的那幾支（聯絡簿、教務日誌、成績…）用固定任課 `schedules.teacher_id`，理由見
 * `kb/wiki/architecture/teacher-students-view.md`：那些是「我的學生」的長期關係。
 * 但點名是當天的事 —— **代課老師當天就是要點那堂課的名**，用固定任課擋他等於讓
 * 代課功能失效。
 */
export interface TeacherWriteScopeInput {
  readonly roles: readonly string[];
  /** 這個使用者自己的 `staff.id`，沒有對應的 staff 列時是 null */
  readonly ownStaffId: string | null;
  /** 這堂課實際上課的老師（`sessions.teacher_id`，含代課） */
  readonly sessionTeacherIds: readonly (string | null)[];
  /** 這堂課固定任課的老師（`schedules.teacher_id`） */
  readonly scheduledTeacherIds: readonly (string | null)[];
}

export function canTeacherWriteAttendance(input: TeacherWriteScopeInput): boolean {
  if (input.roles.includes('admin')) return true;
  if (!input.roles.includes('teacher')) return false;

  // 沒有 staff 列就無法安全地縮限。放行等於把全校的出勤交出去。
  if (!input.ownStaffId) return false;

  return [...input.sessionTeacherIds, ...input.scheduledTeacherIds].some(
    (teacherId) => teacherId === input.ownStaffId,
  );
}

interface EventOwnershipRow {
  teacher_id?: string | null;
  schedules?: { teacher_id?: string | null } | { teacher_id?: string | null }[] | null;
}

/** PostgREST 的巢狀關聯可能回物件也可能回陣列，取決於關係基數。 */
function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * 查出這個 event 的授課老師，然後判斷。**查詢失敗一律當成不通過** ——
 * 授權的洞幾乎都長在「查不到就放行」上。
 */
export async function assertTeacherCanWriteAttendance(
  supabase: SupabaseClient,
  params: { orgId: string; userId: string; roles: readonly string[]; eventId: string },
): Promise<boolean> {
  if (params.roles.includes('admin')) return true;
  if (!params.roles.includes('teacher')) return false;

  const [{ data: ownStaff }, { data: sessionRows, error }] = await Promise.all([
    supabase
      .from('staff')
      .select('id')
      .eq('user_id', params.userId)
      .eq('org_id', params.orgId)
      .maybeSingle(),
    supabase
      .from('sessions')
      .select('teacher_id, schedules!schedule_id(teacher_id)')
      .eq('event_id', params.eventId),
  ]);

  if (error) return false;

  const rows = (sessionRows ?? []) as EventOwnershipRow[];

  return canTeacherWriteAttendance({
    roles: params.roles,
    ownStaffId: (ownStaff?.['id'] as string | undefined) ?? null,
    sessionTeacherIds: rows.map((row) => row.teacher_id ?? null),
    scheduledTeacherIds: rows.flatMap((row) =>
      toArray(row.schedules).map((schedule) => schedule?.teacher_id ?? null),
    ),
  });
}
