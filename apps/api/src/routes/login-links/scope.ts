import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveCampusScope, type CampusScope } from '../../lib/campus-scope';
import { taughtClassIds } from '../../lib/teacher-scope';

/**
 * 登入連結的**分校範圍**（#966 A 批）。`target.ts` 守跨組織、`permission.ts` 守「哪種對象要哪個
 * 權限」，這支守第三件事：**鑄連結的人拿到的是對象看得到的全部**，所以對象看得到的分校
 * 必須全部在呼叫者的範圍內。少了這一層，只管 A 校的管理員可以替不受限的管理員鑄一條連結，
 * 一步就跳出自己的範圍。
 */

export interface TargetReachInput {
  readonly roles: readonly string[];
  /** 對象在 `user_roles.permissions` 的聯集 */
  readonly permissions: readonly string[];
  /** 對象在 `staff_campuses` 的分校 */
  readonly staffCampusIds: readonly string[];
  /** 對象固定任課班級（`taughtClassIds`）的分校 —— 老師的實際觸及範圍，不只指派 */
  readonly taughtCampusIds: readonly string[];
  /** 對象的孩子報名過的班級的分校（任何狀態：退班的歷史也是那個分校的資料） */
  readonly childCampusIds: readonly string[];
}

/**
 * 拿到這個人的帳號，看得到哪些分校。`null` = 不受分校限制。
 *
 * 管理員的部分**呼叫 authMiddleware 同一支 `resolveCampusScope`** —— 這裡判的就是
 * 「他登入之後 middleware 會給他什麼範圍」，寫第二份判準必然分岔（#815）。
 * 老師與家長在 middleware 是 `null`（他們由更窄的任課／子女範圍把關），但那個更窄的範圍
 * 仍然落在某些分校上，所以這裡用他們實際碰得到的分校。
 */
export function targetReach(input: TargetReachInput): CampusScope {
  const reach = new Set<string>();

  if (input.roles.includes('admin')) {
    const adminScope = resolveCampusScope({
      roles: input.roles,
      permissions: input.permissions,
      assignedCampusIds: input.staffCampusIds,
    });
    if (adminScope === null) return null;
    adminScope.forEach((id) => reach.add(id));
  }
  if (input.roles.includes('teacher')) {
    input.staffCampusIds.forEach((id) => reach.add(id));
    input.taughtCampusIds.forEach((id) => reach.add(id));
  }
  // kiosk（#1127）：middleware 照 staff_campuses 限制它，所以觸及範圍就是綁的那些分校
  if (input.roles.includes('kiosk')) {
    input.staffCampusIds.forEach((id) => reach.add(id));
  }
  if (input.roles.includes('parent')) {
    input.childCampusIds.forEach((id) => reach.add(id));
  }

  return [...reach];
}

/**
 * 呼叫者能不能替這個觸及範圍的人鑄連結：**子集**，不是交集。對象有一個分校在外面，
 * 鑄出來的連結就能看到那個分校。
 *
 * 對象一個分校都還沒有（剛註冊、孩子還沒報名）→ 可以：臨櫃註冊完當場給 QR 正是這個時刻，
 * 而那時連結打開來什麼範圍外的東西都看不到。
 */
export function reachWithinScope(callerScope: CampusScope, reach: CampusScope): boolean {
  if (callerScope === null) return true;
  if (reach === null) return false;
  return reach.every((campusId) => callerScope.includes(campusId));
}

/**
 * 查出對象的觸及範圍。**任何一支查詢失敗都丟出** —— 呼叫端當成拒絕（fail-closed），
 * 不能把「查不到」當成「沒有分校」。
 */
export async function loadTargetReach(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  roleRows: ReadonlyArray<{ role: string; permissions?: unknown }>,
): Promise<CampusScope> {
  const roles = roleRows.map((row) => row.role);
  const permissions = roleRows.flatMap((row) =>
    Array.isArray(row.permissions) ? (row.permissions as string[]) : [],
  );

  const [staffResult, parentResult] = await Promise.all([
    supabase
      .from('staff')
      .select('id, staff_campuses(campus_id)')
      .eq('user_id', userId)
      .eq('org_id', orgId),
    supabase
      .from('parents')
      .select('id, parent_student_relations(student_id)')
      .eq('user_id', userId)
      .eq('org_id', orgId),
  ]);
  if (staffResult.error || parentResult.error) throw new Error('查詢對象的分校失敗');

  const staffRows = (staffResult.data ?? []) as Array<{
    id: string;
    staff_campuses?: Array<{ campus_id: string }> | null;
  }>;
  const staffCampusIds = staffRows.flatMap((row) =>
    (row.staff_campuses ?? []).map((link) => link.campus_id),
  );

  const classIds = (
    await Promise.all(staffRows.map((row) => taughtClassIds(supabase, orgId, row.id)))
  ).flat();
  let taughtCampusIds: string[] = [];
  if (classIds.length > 0) {
    const { data, error } = await supabase
      .from('classes')
      .select('campus_id')
      .eq('org_id', orgId)
      .in('id', classIds);
    if (error) throw new Error('查詢任課班級的分校失敗');
    taughtCampusIds = ((data ?? []) as Array<{ campus_id: string }>).map((row) => row.campus_id);
  }

  const studentIds = (
    (parentResult.data ?? []) as Array<{
      parent_student_relations?: Array<{ student_id: string }> | null;
    }>
  ).flatMap((row) => (row.parent_student_relations ?? []).map((link) => link.student_id));
  let childCampusIds: string[] = [];
  if (studentIds.length > 0) {
    // `classes!inner` 寫死：left join 的巢狀欄位會變成 null 留著（#815）
    const { data, error } = await supabase
      .from('enrollments')
      .select('classes!inner(campus_id)')
      .eq('org_id', orgId)
      .in('student_id', studentIds);
    if (error) throw new Error('查詢孩子報名分校失敗');
    childCampusIds = (
      (data ?? []) as Array<{ classes: { campus_id: string } | Array<{ campus_id: string }> }>
    ).flatMap((row) =>
      Array.isArray(row.classes) ? row.classes.map((c) => c.campus_id) : [row.classes.campus_id],
    );
  }

  return targetReach({ roles, permissions, staffCampusIds, taughtCampusIds, childCampusIds });
}
