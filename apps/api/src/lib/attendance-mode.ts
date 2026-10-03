import type { SupabaseClient } from '@supabase/supabase-js';

export type AttendanceMode = 'per_session' | 'daily_checkin';

/**
 * **出勤模式是分校層級**（#1112；flows/attendance.md 2、specs/admin/system/campuses.md）。
 * `campuses.attendance_mode` 是 nullable：null = 沿用 `organizations.attendance_mode`（機構預設）。
 * 兩邊都讀不到時跟 DB 預設一致（日到班，#976）。
 */
export function pickAttendanceMode(
  campusMode: string | null | undefined,
  orgMode: string | null | undefined,
): AttendanceMode {
  return (campusMode ?? orgMode ?? 'daily_checkin') as AttendanceMode;
}

/**
 * 讀某個分校實際生效的出勤模式。**所有讀出勤模式的地方都走這支** —— 各自讀
 * `organizations` 的話，分校設定只會在其中幾處生效，而那個不一致沒有人看得到。
 *
 * - `campusId` 沒給（打卡沒帶分校、作業台看多校）→ 機構預設
 * - 分校查詢帶 `org_id`（c1）：別 org 的分校 id 查不到列，退回本 org 的預設
 * - 讀機構失敗回 `error`，**呼叫端不要猜**（daily-checkins 在任何寫入前就停）。
 *   分校那支讀失敗則退回機構預設 —— 它是覆寫值，缺了仍有一個合法答案。
 */
export async function resolveAttendanceMode(
  supabase: SupabaseClient,
  orgId: string,
  campusId: string | null | undefined,
): Promise<{ mode: AttendanceMode; error: null } | { mode: null; error: { message: string } }> {
  const [org, campus] = await Promise.all([
    supabase.from('organizations').select('attendance_mode').eq('id', orgId).maybeSingle(),
    campusId
      ? supabase
          .from('campuses')
          .select('attendance_mode')
          .eq('id', campusId)
          .eq('org_id', orgId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (org.error) return { mode: null, error: { message: org.error.message } };

  return {
    mode: pickAttendanceMode(
      (campus.data as { attendance_mode?: string | null } | null)?.attendance_mode,
      (org.data as { attendance_mode?: string } | null)?.attendance_mode,
    ),
    error: null,
  };
}
