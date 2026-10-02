import type { SupabaseClient } from '@supabase/supabase-js';

import type { CampusScope } from './campus-scope';

/**
 * **寫入面的分校範圍**（#966 C 批）：body 或 path 只帶學生／課堂／班級的 id 時，
 * 全域的 `campusRequestGuard` 看不到分校（它只讀 query string），所以要在這裡從資源本身
 * 解出分校再比。判準刻意跟**讀取面同一份**：寫得到的 = 看得到的。
 *
 * 三支都是「`scope === null` 就不查」—— 不受限的管理員、老師、家長不多付任何一次往返
 * （老師由 teacher-scope 把關，那比分校更窄）。
 */

/**
 * 一筆**自己帶 `campus_id` 的資源**（課堂 `events`、打卡 `daily_checkins`）在不在範圍內。
 * 課堂的分校取 `events.campus_id`，跟 `GET /api/attendance` 的
 * `events!inner(campus_id)` + `applyCampusFilter` 同一個欄位。
 *
 * ⚠️ `campus_id` 是 null 時受限者一律拒絕 —— 讀取面的 `.in('events.campus_id', …)` 會把
 * null 排除，所以那堂課他本來就看不到；這裡**不能**照 `isCampusAllowed` 的「沒指名就放行」。
 */
export function resourceCampusAllowed(
  scope: CampusScope,
  campusId: string | null | undefined,
): boolean {
  if (scope === null) return true;
  return !!campusId && scope.includes(campusId);
}

/**
 * 這個學生在不在範圍內：**有任何一筆報名的班級在範圍內就算**（任何狀態）。
 * 跟 `GET /api/leaves`（`routes/leaves.ts` 的列表）與家長範圍（`lib/parent-campus-scope.ts`）
 * 同一個判準 —— 跨分校的孩子，任一分校的管理員都看得到，也就都寫得到（#816 的裁定）。
 */
export async function isStudentInScope(
  supabase: SupabaseClient,
  orgId: string,
  scope: CampusScope,
  studentId: string,
): Promise<boolean> {
  if (scope === null) return true;
  if (scope.length === 0) return false;

  // `classes!inner` 寫死：left join 的巢狀條件不會排除父列（#815）
  const { data, error } = await supabase
    .from('enrollments')
    .select('student_id, classes!inner(campus_id)')
    .eq('org_id', orgId)
    .eq('student_id', studentId)
    .in('classes.campus_id', [...scope])
    .limit(1);

  // 查不到 ≠ 不在範圍：查詢失敗也拒絕（fail-closed）
  return !error && (data ?? []).length > 0;
}

/** 這個班在不在範圍內（`classes.campus_id` NOT NULL） */
export async function isClassInScope(
  supabase: SupabaseClient,
  orgId: string,
  scope: CampusScope,
  classId: string,
): Promise<boolean> {
  if (scope === null) return true;

  const { data, error } = await supabase
    .from('classes')
    .select('campus_id')
    .eq('org_id', orgId)
    .eq('id', classId)
    .maybeSingle();

  const campusId = (data as { campus_id?: string } | null)?.campus_id;
  return !error && !!campusId && scope.includes(campusId);
}
