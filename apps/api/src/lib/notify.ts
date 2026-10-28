import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveCampusScope } from './campus-scope';
import { hasPermission } from './permissions';
import { isScheduleEffectiveOn, scheduleRangeOf, type ScheduleRange } from './schedule-effective';

/**
 * 站內通知的寫入與收件人推導（#1693，#1626 改版：「通知是一筆紀錄，推播只是送達管道」）。
 *
 * 老師與管理員第一版**不推播、只進通知中心**（使用者更正 Q7）：寫入時就是
 * `push_status = 'skipped'`、`push_error = 'ROLE_PUSH_DISABLED'`，排程（#1661）不必再處理。
 * 家長的繳費提醒由排程自己寫（`lib/push-run.ts`），不走這裡。
 *
 * **事件型通知在業務寫入成功之後才排入；排入失敗只記 log、不讓原本的請求失敗** ——
 * 通知是附帶的，業務寫入已經成功卻回 500，只會讓人去重送一次業務寫入。
 */

export type StaffNotificationKind =
  | 'application_received'
  | 'overdue_digest'
  | 'unbilled_reminder'
  | 'schedule_change'
  | 'leave_for_my_class'
  | 'leave_received'
  | 'grade_promotion_reminder'
  | 'application_overdue'
  | 'trial_followup'
  | 'leave_streak'
  | 'contact_book_reminder';

export interface StaffNotification {
  readonly orgId: string;
  readonly userId: string;
  readonly role: 'admin' | 'teacher';
  readonly kind: StaffNotificationKind;
  /** 同一個收件人同一個鍵只會有一則（UNIQUE(user_id, dedupe_key)） */
  readonly dedupeKey: string;
  readonly title: string;
  readonly body: string;
  /** 點了要去的頁；沒有就 null */
  readonly url: string | null;
}

/** 寫入通知；重複的鍵略過。**不丟例外**：失敗只記 log，回寫進去的筆數（失敗 = 0） */
export async function notify(
  supabase: SupabaseClient,
  rows: readonly StaffNotification[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase
    .from('notifications')
    .upsert(
      rows.map((r) => ({
        org_id: r.orgId,
        user_id: r.userId,
        role: r.role,
        kind: r.kind,
        dedupe_key: r.dedupeKey,
        payload: { title: r.title, body: r.body, url: r.url },
        push_status: 'skipped',
        push_error: 'ROLE_PUSH_DISABLED',
      })),
      { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
    )
    .select('id');
  if (error) {
    console.error('[notify] 寫入通知失敗（業務寫入已成功，不回滾）:', error.message);
    return 0;
  }
  return (data ?? []).length;
}

/**
 * 範圍包含這些分校的管理員（user_id）。**判準就是 `resolveCampusScope`**，只是方向反過來：
 * 對每個候選人算出他的範圍，`null`（全分校）或跟 `campusIds` 有交集就收。
 *
 * - 候選人：本 org、`staff.status = 'active'` 的教職員，而且有 admin 角色
 * - 角色與權限是 `user_roles` 各列的聯集（跟 `middleware/auth.ts` 同一個算法）
 * - `permission`：財務類通知再要求這個權限（`*` 也算）
 */
export async function adminsForCampuses(
  supabase: SupabaseClient,
  orgId: string,
  campusIds: readonly string[],
  options: { readonly permission?: string; readonly excludeUserId?: string } = {},
): Promise<string[]> {
  const { data: staff, error: staffError } = await supabase
    .from('staff')
    .select('id, user_id')
    .eq('org_id', orgId)
    .eq('status', 'active');
  if (staffError) throw new Error(`查詢教職員失敗：${staffError.message}`);
  const staffRows = (staff ?? []) as Array<{ id: string; user_id: string }>;
  if (staffRows.length === 0) return [];

  const userIds = staffRows.map((s) => s.user_id);
  const { data: roleRows, error: rolesError } = await supabase
    .from('user_roles')
    .select('user_id, role, permissions')
    .in('user_id', userIds);
  if (rolesError) throw new Error(`查詢角色失敗：${rolesError.message}`);
  const identity = new Map<string, { roles: string[]; permissions: string[] }>();
  for (const r of (roleRows ?? []) as Array<{
    user_id: string;
    role: string;
    permissions: unknown;
  }>) {
    const cur = identity.get(r.user_id) ?? { roles: [], permissions: [] };
    cur.roles.push(r.role);
    if (Array.isArray(r.permissions)) cur.permissions.push(...(r.permissions as string[]));
    identity.set(r.user_id, cur);
  }

  const adminStaff = staffRows.filter((s) => identity.get(s.user_id)?.roles.includes('admin'));
  if (adminStaff.length === 0) return [];
  const { data: links, error: linksError } = await supabase
    .from('staff_campuses')
    .select('staff_id, campus_id')
    .in(
      'staff_id',
      adminStaff.map((s) => s.id),
    );
  if (linksError) throw new Error(`查詢分校指派失敗：${linksError.message}`);
  const assigned = new Map<string, string[]>();
  for (const l of (links ?? []) as Array<{ staff_id: string; campus_id: string }>) {
    assigned.set(l.staff_id, [...(assigned.get(l.staff_id) ?? []), l.campus_id]);
  }

  const wanted = new Set(campusIds);
  const out = new Set<string>();
  for (const s of adminStaff) {
    const id = identity.get(s.user_id)!;
    if (options.permission && !hasPermission(id.permissions, options.permission)) continue;
    const scope = resolveCampusScope({
      roles: id.roles,
      permissions: id.permissions,
      assignedCampusIds: assigned.get(s.id) ?? [],
    });
    if (scope === null || scope.some((c) => wanted.has(c))) out.add(s.user_id);
  }
  if (options.excludeUserId) out.delete(options.excludeUserId);
  return [...out];
}

/**
 * 這些課堂的老師（user_id）：**任課班的老師（`schedules.teacher_id`）∪ 該堂實際上課的人
 * （`sessions.teacher_id`）∪ 額外指名的 staff**（代課的原老師與新老師、換任課老師的新舊兩位）。
 * 任課班只算**那堂課當天有效的時段**的老師（#1100 #22 Q3）——
 * 換過手的班，舊老師收不到換手後的課堂的通知。
 *
 * - 只收本 org、`status = 'active'`、而且有 teacher 角色的人（沒有 teacher 角色的收了也看不到）
 * - `excludeUserId`：做這個異動的人自己不收
 */
export async function teachersForSessions(
  supabase: SupabaseClient,
  orgId: string,
  sessionIds: readonly string[],
  options: { readonly extraStaffIds?: readonly string[]; readonly excludeUserId?: string } = {},
): Promise<string[]> {
  const groups = await teachersForSessionGroups(
    supabase,
    orgId,
    new Map([['all', { sessionIds, extraStaffIds: options.extraStaffIds }]]),
    { excludeUserId: options.excludeUserId },
  );
  return groups.get('all') ?? [];
}

/**
 * `teachersForSessions` 的分組版：一次查完、**查詢句數固定（4 句），不隨組數成長** ——
 * 課務異動一批可能跨好幾個班，每班一則通知，逐班呼叫會把 subrequest 吃光。
 * 每組的收件人只算**那一組的課堂**（別班的老師不會因為同一批而收到）。
 */
export async function teachersForSessionGroups<K>(
  supabase: SupabaseClient,
  orgId: string,
  groups: ReadonlyMap<
    K,
    { readonly sessionIds: readonly string[]; readonly extraStaffIds?: readonly string[] }
  >,
  options: { readonly excludeUserId?: string } = {},
): Promise<Map<K, string[]>> {
  const allSessionIds = [...new Set([...groups.values()].flatMap((g) => g.sessionIds))];
  const sessionById = new Map<
    string,
    { class_id: string; teacher_id: string | null; session_date: string | null }
  >();
  const classSchedules = new Map<string, Array<{ teacher_id: string; range: ScheduleRange }>>();
  if (allSessionIds.length > 0) {
    const { data: sessions, error } = await supabase
      .from('sessions')
      .select('id, class_id, teacher_id, session_date')
      .eq('org_id', orgId)
      .in('id', allSessionIds);
    if (error) throw new Error(`查詢課堂失敗：${error.message}`);
    for (const r of (sessions ?? []) as Array<{
      id: string;
      class_id: string;
      teacher_id: string | null;
      session_date: string | null;
    }>) {
      sessionById.set(r.id, r);
    }
    const classIds = [...new Set([...sessionById.values()].map((r) => r.class_id))];
    if (classIds.length > 0) {
      // schedules 沒有 org_id —— org 的界線走 classes（同 taughtClassIds）
      const { data: schedules, error: schedError } = await supabase
        .from('schedules')
        .select('class_id, teacher_id, effective_from, effective_to, classes!inner(org_id)')
        .eq('classes.org_id', orgId)
        .in('class_id', classIds);
      if (schedError) throw new Error(`查詢任課老師失敗：${schedError.message}`);
      for (const s of (schedules ?? []) as Array<Record<string, unknown>>) {
        const teacherId = s['teacher_id'] as string | null;
        const classId = s['class_id'] as string;
        if (teacherId) {
          classSchedules.set(classId, [
            ...(classSchedules.get(classId) ?? []),
            { teacher_id: teacherId, range: scheduleRangeOf(s) },
          ]);
        }
      }
    }
  }

  const staffByGroup = new Map<K, Set<string>>();
  for (const [key, g] of groups) {
    const staffIds = new Set(g.extraStaffIds ?? []);
    for (const id of g.sessionIds) {
      const s = sessionById.get(id);
      if (!s) continue;
      if (s.teacher_id) staffIds.add(s.teacher_id);
      // 那堂課當天有效的時段的老師（#1100 #22 Q3）；課堂還沒排日期就不篩
      for (const t of classSchedules.get(s.class_id) ?? []) {
        if (s.session_date === null || isScheduleEffectiveOn(t.range, s.session_date)) {
          staffIds.add(t.teacher_id);
        }
      }
    }
    staffByGroup.set(key, staffIds);
  }
  const out = new Map<K, string[]>([...groups.keys()].map((k) => [k, []]));
  const allStaffIds = [...new Set([...staffByGroup.values()].flatMap((s) => [...s]))];
  if (allStaffIds.length === 0) return out;

  const { data: staff, error: staffError } = await supabase
    .from('staff')
    .select('id, user_id')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .in('id', allStaffIds);
  if (staffError) throw new Error(`查詢教職員失敗：${staffError.message}`);
  const userByStaff = new Map(
    ((staff ?? []) as Array<{ id: string; user_id: string }>).map((s) => [s.id, s.user_id]),
  );
  if (userByStaff.size === 0) return out;

  const { data: teachers, error: rolesError } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'teacher')
    .in('user_id', [...new Set(userByStaff.values())]);
  if (rolesError) throw new Error(`查詢角色失敗：${rolesError.message}`);
  const isTeacher = new Set(((teachers ?? []) as Array<{ user_id: string }>).map((t) => t.user_id));

  for (const [key, staffIds] of staffByGroup) {
    const users = new Set<string>();
    for (const id of staffIds) {
      const u = userByStaff.get(id);
      if (u && isTeacher.has(u) && u !== options.excludeUserId) users.add(u);
    }
    out.set(key, [...users]);
  }
  return out;
}
