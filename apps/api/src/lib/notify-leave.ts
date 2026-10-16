import type { SupabaseClient } from '@supabase/supabase-js';

import { notify, teachersForSessionGroups } from './notify';
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
