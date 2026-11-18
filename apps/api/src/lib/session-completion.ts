import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAttendanceModes } from './attendance-mode';
import { IN_CHUNK_SIZE } from './in-chunks';

/**
 * **課堂「發生了」的唯一寫入點**（#2546）：點名提交過（`events.attendance_taken_at` 有值）的課堂，
 * 在「點名制（per_session）」的分校 `sessions.status` 就是 `completed`。
 *
 * - 只動 `scheduled`：`cancelled` 不被改回（停課的堂補登出勤仍是停課）、`completed` 不重寫。
 * - **日到班（daily_checkin）的分校不動**：日到班沒有「點名提交」動作，維持日期判斷（計畫席 11-18 裁定）。
 * - 冪等、可重跑：失敗時 taken_at 已寫、status 沒改，下一次提交或復課會再收斂，不需要交易。
 *
 * 批次點名提交與復課（cancelled → scheduled 後若已點名要回 completed）共用這一支。
 */
export async function completeTakenSessions(
  supabase: SupabaseClient,
  orgId: string,
  sessionIds: readonly string[],
): Promise<{ completed: number; error: { message: string } | null }> {
  let completed = 0;
  for (let i = 0; i < sessionIds.length; i += IN_CHUNK_SIZE) {
    const chunk = sessionIds.slice(i, i + IN_CHUNK_SIZE);
    const { data, error } = await supabase
      .from('sessions')
      .select('id, events!event_id(attendance_taken_at, campus_id)')
      .eq('org_id', orgId)
      .eq('status', 'scheduled')
      .in('id', chunk);
    if (error) return { completed, error };

    type Row = {
      id: string;
      events: { attendance_taken_at: string | null; campus_id: string | null } | null;
    };
    const taken = ((data ?? []) as unknown as Row[]).filter((r) => r.events?.attendance_taken_at);
    if (taken.length === 0) continue;

    const campusIds = [...new Set(taken.map((r) => r.events!.campus_id).filter((id) => !!id))];
    const modes = await resolveAttendanceModes(supabase, orgId, campusIds as string[]);
    if (modes.error) return { completed, error: modes.error };

    const ids = taken
      .filter((r) => modes.modeOf(r.events!.campus_id) === 'per_session')
      .map((r) => r.id);
    if (ids.length === 0) continue;

    const { error: updateError } = await supabase
      .from('sessions')
      .update({ status: 'completed' })
      .eq('org_id', orgId)
      .eq('status', 'scheduled')
      .in('id', ids);
    if (updateError) return { completed, error: updateError };
    completed += ids.length;
  }
  return { completed, error: null };
}
