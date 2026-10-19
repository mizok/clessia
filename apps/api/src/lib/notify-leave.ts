import type { SupabaseClient } from '@supabase/supabase-js';

import { adminsForCampuses, notify, teachersForSessionGroups } from './notify';
import { groupByClass, shortDate } from './notify-schedule';

/**
 * 有學生請了老師的課 → 那幾堂的老師（#1693 `leave_for_my_class`）。
 *
 * - 掛在管理員代請假（`POST /api/leaves`）與編輯假單新增的堂（`PATCH`，只傳新增的）；家長端請假（#1695）上線時用同一支
 * - `sessionIds` 是 `applyLeaveAttendance` 算出來蓋到的那幾堂（綁定堂次、時間窗、在籍都算過），不另算
 * - 依班分組、每班一則：老師只收自己班的；做這件事的人自己不收
 * - 不丟例外：假單已經寫入，失敗只記 `[notify]` log
 */
/** 這一組裡日期最早的那堂（同日取 id 小的），當作這一批的識別 */
function firstSessionId(g: { readonly dates: string[]; readonly sessionIds: string[] }): string {
  return g.sessionIds
    .map((id, i) => [g.dates[i]!, id] as const)
    .sort(([da, a], [db, b]) => da.localeCompare(db) || a.localeCompare(b))[0]![1];
}

export async function notifyLeaveForTeachers(
  supabase: SupabaseClient,
  input: {
    readonly orgId: string;
    readonly actorUserId: string;
    readonly leaveId: string;
    readonly studentName: string;
    readonly sessionIds: readonly string[];
  },
): Promise<void> {
  try {
    if (input.sessionIds.length === 0) return;
    const byClass = await groupByClass(
      supabase,
      input.orgId,
      input.sessionIds.map((id) => ({ session_id: id })),
    );
    if (byClass.size === 0) return;
    const recipients = await teachersForSessionGroups(supabase, input.orgId, byClass, {
      excludeUserId: input.actorUserId,
    });
    await notify(
      supabase,
      [...byClass].flatMap(([classId, g]) => {
        const first = shortDate([...g.dates].sort()[0]!);
        const count = g.dates.length > 1 ? ` 等 ${g.dates.length} 堂` : '';
        return (recipients.get(classId) ?? []).map((userId) => ({
          orgId: input.orgId,
          userId,
          role: 'teacher' as const,
          kind: 'leave_for_my_class' as const,
          // 同一張假可以延長好幾次，每次只通知新增的堂：鍵帶這一批最早那堂，
          // 重送同一批仍然去重，延長（新的堂）就是新的一則
          dedupeKey: `leave:${input.leaveId}:${classId}:${firstSessionId(g)}`,
          title: '學生請假',
          body: `${input.studentName} 請假：${g.name} ${first}${count}`,
          url: '/teacher/schedule',
        }));
      }),
    );
  } catch (err) {
    console.error('[notify] 請假通知失敗（假單已寫入）:', err instanceof Error ? err.message : err);
  }
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 家長幫孩子請假 → 被請假的那幾堂所屬分校、有 `basic_operations`（或 `*`）的管理員（#1695 `leave_received`，
 * 設計稿 kb/wiki/specs/parent/leave.md §4）。
 *
 * - 一張假、一個管理員只收一則（`dedupe_key = leave:<leaveId>:<userId>`），不管蓋到幾堂幾班
 * - 分校由堂次的班推導（c1），不吃呼叫端；`sessionIds` 只是「真的改成請假的那幾堂」
 * - `retroactive`：蓋到的課有一堂已經開始 → 標題標「補請」（沒有人核對，方便行政事後看）
 * - 不丟例外：假單已經寫入，失敗只記 `[notify]` log
 */
export async function notifyLeaveForAdmins(
  supabase: SupabaseClient,
  input: {
    readonly orgId: string;
    readonly leaveId: string;
    readonly studentName: string;
    readonly reason: string | null;
    readonly sessionIds: readonly string[];
    readonly retroactive: boolean;
  },
): Promise<void> {
  try {
    if (input.sessionIds.length === 0) return;
    const { data, error } = await supabase
      .from('sessions')
      .select('id, session_date, classes(name, campus_id)')
      .eq('org_id', input.orgId)
      .in('id', [...input.sessionIds]);
    if (error) throw new Error(error.message);
    const sessions = (
      (data ?? []) as Array<{
        id: string;
        session_date: string;
        classes:
          { name: string; campus_id: string } | Array<{ name: string; campus_id: string }> | null;
      }>
    )
      .map((s) => ({ ...s, cls: Array.isArray(s.classes) ? s.classes[0] : s.classes }))
      .sort((a, b) => a.session_date.localeCompare(b.session_date) || a.id.localeCompare(b.id));
    const campusIds = [...new Set(sessions.flatMap((s) => (s.cls ? [s.cls.campus_id] : [])))];
    if (campusIds.length === 0) return;
    const recipients = await adminsForCampuses(supabase, input.orgId, campusIds, {
      permission: 'basic_operations',
    });

    const first = sessions[0]!;
    const weekday = WEEKDAY[new Date(`${first.session_date}T00:00:00Z`).getUTCDay()];
    const count = sessions.length > 1 ? ` 等 ${sessions.length} 堂` : '';
    const reason = input.reason?.trim() ? `，原因：${input.reason.trim()}` : '';
    const body = `${input.studentName}的家長請假：${shortDate(first.session_date)}（${weekday}）${first.cls?.name ?? ''}${count}${reason}`;
    await notify(
      supabase,
      recipients.map((userId) => ({
        orgId: input.orgId,
        userId,
        role: 'admin' as const,
        kind: 'leave_received' as const,
        dedupeKey: `leave:${input.leaveId}:${userId}`,
        title: input.retroactive ? '家長請假（補請）' : '家長請假',
        body,
        url: '/admin/leave',
      })),
    );
  } catch (err) {
    console.error(
      '[notify] 家長請假通知管理員失敗（假單已寫入）:',
      err instanceof Error ? err.message : err,
    );
  }
}
