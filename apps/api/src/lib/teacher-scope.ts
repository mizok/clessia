import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 聯絡簿與教務日誌共用的範圍規則：管理員不受限，老師只能碰自己固定任課的班。
 *
 * **範圍限制放在伺服器，而且不看請求怎麼說** —— 前端隱藏不構成授權（c1）。
 * 「自己任課」取 `schedules.teacher_id`（固定任課）而不是 `sessions.teacher_id`
 * （含代課），理由見 kb/wiki/architecture/teacher-students-view.md。
 *
 * `routes/students/teacher-scope.ts` 與 `routes/attendance/teacher-scope.ts` 是同一個模式的
 * 前兩份。沒有把三份合併成一份，是因為那兩份各自綁著自己路由的輸入型別
 * （`taughtByMe` 之類），合併要動到兩個已經在跑的功能；這一份是新的兩個 feature 共用，
 * 放在 lib/ 下。真要收斂成一份的時候，這裡是收斂的目標。
 */
export interface TeachingScopeInput {
  readonly roles: readonly string[];
  readonly ownStaffId: string | null;
}

export type TeachingScope = { teacherStaffId: string | null } | { forbidden: true };

export function resolveTeachingScope(input: TeachingScopeInput): TeachingScope {
  if (input.roles.includes('admin')) {
    return { teacherStaffId: null };
  }

  if (input.roles.includes('teacher')) {
    // 沒有 staff 列就無法安全地縮限，放行等於把全校的紀錄交出去
    return input.ownStaffId ? { teacherStaffId: input.ownStaffId } : { forbidden: true };
  }

  return { forbidden: true };
}

/**
 * 從請求脈絡解析範圍：管理員不查 staff（不受限所以不必查），老師才查。
 */
export async function loadTeachingScope(
  supabase: SupabaseClient,
  params: { orgId: string; userId: string; roles: readonly string[] },
): Promise<TeachingScope> {
  if (params.roles.includes('admin')) {
    return resolveTeachingScope({ roles: params.roles, ownStaffId: null });
  }

  const { data } = await supabase
    .from('staff')
    .select('id')
    .eq('user_id', params.userId)
    .eq('org_id', params.orgId)
    .maybeSingle();

  return resolveTeachingScope({
    roles: params.roles,
    ownStaffId: (data?.['id'] as string | undefined) ?? null,
  });
}

/** 這位老師固定任課的班級 id。空陣列＝他沒有任何班，呼叫端該回空結果而不是全部。 */
export async function taughtClassIds(
  supabase: SupabaseClient,
  orgId: string,
  teacherStaffId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('schedules')
    .select('class_id')
    .eq('org_id', orgId)
    .eq('teacher_id', teacherStaffId);

  return Array.from(
    new Set((data ?? []).map((r: Record<string, unknown>) => r['class_id'] as string)),
  );
}

/** 這位老師固定任課班級裡的在籍學生 id。 */
export async function taughtStudentIds(
  supabase: SupabaseClient,
  orgId: string,
  teacherStaffId: string,
): Promise<string[]> {
  const classIds = await taughtClassIds(supabase, orgId, teacherStaffId);
  if (classIds.length === 0) return [];

  const { data } = await supabase
    .from('enrollments')
    .select('student_id')
    .eq('org_id', orgId)
    .in('class_id', classIds);

  return Array.from(
    new Set((data ?? []).map((r: Record<string, unknown>) => r['student_id'] as string)),
  );
}
