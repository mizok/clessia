import type { SupabaseClient } from '@supabase/supabase-js';

import { canTeacherWriteAttendance } from './attendance-write-scope';

/**
 * 老師能不能讀這一堂課的點名名單（#1081）。
 *
 * 名單 GET 原本只有 `.eq('org_id')` —— 同 org 的老師知道 `eventId` 就讀得到任一堂的名單。
 * 跟寫入那側（`attendance-write-scope.ts`、authorization-scope 洞 4）同一個形狀，在讀的這一側。
 *
 * **歸屬規則跟寫入同一份**（任課或代課，`canTeacherWriteAttendance` 那支純函式）：名單是點名畫面的
 * 資料來源，代課老師當天就是要看那堂的名單。**但不看點名責任歸屬** —— 行政負責點名的機構，
 * 老師端仍要唯讀看自己課的名單（#920）；責任歸屬只管寫。
 *
 * 查詢失敗一律當成不通過 —— 授權的洞幾乎都長在「查不到就放行」上。
 *
 * ponytail: staff／sessions 的查詢跟 attendance-write-scope 的寫入版重複一份 ——
 * 兩支保留類 PR（#1080、#1081）同時在飛，放同一檔會互相衝突；都合併後再收成一支。
 */
export async function teacherCanReadEvent(
  supabase: SupabaseClient,
  params: { orgId: string; userId: string; roles: readonly string[]; eventId: string },
): Promise<boolean> {
  if (params.roles.includes('admin')) return true;
  if (!params.roles.includes('teacher')) return false;

  const [{ data: ownStaff, error: staffError }, { data: sessionRows, error }] = await Promise.all([
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
  if (staffError || error) return false;

  const rows = (sessionRows ?? []) as {
    teacher_id?: string | null;
    schedules?: { teacher_id?: string | null } | { teacher_id?: string | null }[] | null;
  }[];
  const schedules = (r: (typeof rows)[number]) =>
    !r.schedules ? [] : Array.isArray(r.schedules) ? r.schedules : [r.schedules];

  return canTeacherWriteAttendance({
    roles: params.roles,
    ownStaffId: (ownStaff?.['id'] as string | undefined) ?? null,
    sessionTeacherIds: rows.map((r) => r.teacher_id ?? null),
    scheduledTeacherIds: rows.flatMap((r) => schedules(r).map((s) => s?.teacher_id ?? null)),
  });
}
