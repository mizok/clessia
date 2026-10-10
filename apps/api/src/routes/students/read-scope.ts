import type { SupabaseClient } from '@supabase/supabase-js';

import type { CampusScope } from '../../lib/campus-scope';
import { studentInScope } from '../../lib/invoice-campus-scope';
import { findInOrg } from '../../lib/org-scope';
import { taughtStudentIds } from '../../lib/teacher-scope';
import { resolveStudentScope } from './teacher-scope';

/**
 * 「誰讀得到這個學生」的兩道判斷。`GET /students/{id}` 與 `GET /students/{id}/attendance-days`
 * 共用 —— 各寫一份就是同一條授權的兩個版本（#1314 SD2）。
 */

/**
 * #1394：受限管理員的單筆讀寫跟列表同一條判準 —— 學生任一報名（不分 status）的班在範圍內
 * （`studentInScope`，同列表 `scopedStudentIds` 與 `invoices.ts`）。**範圍外跟不存在一樣回 404。**
 * 沒有任何報名的學生推不出分校，對受限者是範圍外（列表本來就看不到）⇒ 受限者實質不能刪學生，
 * 孤兒清理留給全校區管理員（計畫席 10-10 過）。`scope === null`（全校區、老師、家長）不多查。
 */
export async function outOfCampusScope(
  supabase: SupabaseClient,
  orgId: string,
  id: string,
  scope: CampusScope,
): Promise<boolean> {
  if (scope === null) return false;
  const student = await findInOrg(
    supabase,
    'students',
    orgId,
    id,
    'id, enrollments(classes(campus_id))',
  );
  return !student || !studentInScope(student['enrollments'], scope);
}

/**
 * #1098：老師只讀得到自己固定任課班的學生（跟列表同一個範圍，代課不算「我的學生」）。
 * 管理員回 false（不在這裡擋）；不是他的學生 → true（呼叫端回 403）。
 */
export async function teacherCannotRead(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  roles: readonly string[],
  id: string,
): Promise<boolean> {
  if (roles.includes('admin')) return false;
  const { data: ownStaff } = await supabase
    .from('staff')
    .select('id')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle();
  const scope = resolveStudentScope({
    roles,
    taughtByMe: true,
    ownStaffId: (ownStaff?.id as string | undefined) ?? null,
  });
  return (
    'forbidden' in scope ||
    !(await taughtStudentIds(supabase, orgId, scope.teacherStaffId!)).includes(id)
  );
}
