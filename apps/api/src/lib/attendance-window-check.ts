import type { SupabaseClient } from '@supabase/supabase-js';

import { isAttendanceEditable } from './attendance-window';
import { getCurrentTaipeiDateString } from './taipei-date';

/**
 * 補登窗的伺服器端檢查。
 *
 * **原本是 `routes/attendance.ts` 的私有函式。** 取消打卡也要走同一條窗
 * （作業台需求單 2026-09-03）—— 另寫一套的話，同一間補習班對「昨天的紀錄還能不能改」
 * 會有兩個答案，而那兩個答案會在不同的畫面上出現。**在 2026-08-30 之前這個窗只在前端讀**
 * （`teacher/schedule.page.ts:122-127`），老師直接打 API 可以改任何日期的出勤 ——
 * 前端隱藏不構成限制，跟 c1 的道理一樣。
 *
 * 這裡照抄前端的兩個條件（見 `lib/attendance-window.ts`）：這個切片是**把規則搬到
 * 伺服器，不是改變規則**。管理員豁免，但窗外的修改會留下 audit log。
 */
export async function assertAttendanceWindow(
  supabase: SupabaseClient,
  params: { orgId: string; roles: readonly string[]; eventDate: string },
): Promise<{ ok: true; outOfWindowByAdmin: boolean } | { ok: false }> {
  const { data: org } = await supabase
    .from('organizations')
    .select('attendance_responsible, attendance_retroactive_days')
    .eq('id', params.orgId)
    .maybeSingle();

  const responsible =
    ((org as { attendance_responsible?: string } | null)?.attendance_responsible as
      'admin' | 'teacher') ?? 'admin';
  const retroactiveDays = Number(
    (org as { attendance_retroactive_days?: number } | null)?.attendance_retroactive_days ?? 0,
  );
  const isAdmin = params.roles.includes('admin');
  const today = getCurrentTaipeiDateString();

  if (
    !isAttendanceEditable({
      isAdmin,
      responsible,
      retroactiveDays,
      eventDate: params.eventDate,
      today,
    })
  ) {
    return { ok: false };
  }

  // 管理員在窗外動手是低頻但高風險的動作 —— 記一筆，不然「誰把三個月前的出勤改掉了」
  // 沒有人查得出來
  const outOfWindowByAdmin =
    isAdmin &&
    !isAttendanceEditable({
      isAdmin: false,
      responsible,
      retroactiveDays,
      eventDate: params.eventDate,
      today,
    });

  return { ok: true, outOfWindowByAdmin };
}
