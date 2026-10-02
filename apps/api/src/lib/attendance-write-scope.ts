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
 * 老師寫出勤的三種結果。**原本是 boolean（`assertTeacherCanWriteAttendance`）**，#920 加了第三種
 * 「機構由行政負責點名」時一併改名 —— 回字串的函式若還叫 assert…／can…，漏改的
 * `if (!(await …))` 會**永遠是 false（非空字串是 truthy）而靜靜全放行**，typecheck 不會報。
 */
export type TeacherAttendanceWriteAccess = 'ok' | 'not-yours' | 'not-responsible';

/**
 * 查出這個 event 的授課老師與機構的點名責任，然後判斷。**查詢失敗一律當成不通過** ——
 * 授權的洞幾乎都長在「查不到就放行」上。
 *
 * **行政負責點名（`attendance_responsible = 'admin'`）的機構，老師一律不能寫（#920）。**
 * 老師端在那種機構只給唯讀的到班狀態；這道原本只靠老師端不渲染點名鈕（c1：前端隱藏
 * UI 不構成授權）。讀不到設定時跟前端、補登窗同一個預設：`'admin'`。
 */
export async function teacherAttendanceWriteAccess(
  supabase: SupabaseClient,
  params: { orgId: string; userId: string; roles: readonly string[]; eventId: string },
): Promise<TeacherAttendanceWriteAccess> {
  if (params.roles.includes('admin')) return 'ok';
  if (!params.roles.includes('teacher')) return 'not-yours';

  const [{ data: org, error: orgError }, { data: ownStaff }, { data: sessionRows, error }] =
    await Promise.all([
      supabase
        .from('organizations')
        .select('attendance_responsible')
        .eq('id', params.orgId)
        .maybeSingle(),
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

  if (orgError || error) return 'not-yours';
  const responsible =
    (org as { attendance_responsible?: string } | null)?.attendance_responsible ?? 'admin';
  if (responsible !== 'teacher') return 'not-responsible';

  const rows = (sessionRows ?? []) as EventOwnershipRow[];

  return canTeacherWriteAttendance({
    roles: params.roles,
    ownStaffId: (ownStaff?.['id'] as string | undefined) ?? null,
    sessionTeacherIds: rows.map((row) => row.teacher_id ?? null),
    scheduledTeacherIds: rows.flatMap((row) =>
      toArray(row.schedules).map((schedule) => schedule?.teacher_id ?? null),
    ),
  })
    ? 'ok'
    : 'not-yours';
}
