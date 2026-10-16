import type { SupabaseClient } from '@supabase/supabase-js';

import { adminsForCampuses, notify } from './notify';

/**
 * 各事件的站內通知（#1693）。每支都**不丟例外**：業務寫入已經成功了，通知是附帶的 ——
 * 查收件人或寫入失敗只記 `[notify]` log。呼叫端用 `waitUntil` 背景跑，不拖慢回應。
 */

/**
 * 公開表單送進來的報名／試聽申請 → 通知申請所指班級或課程所在分校的管理員，
 * **而且要有 `manage_students`**：申請頁（`/admin/applications`）連讀都要這個權限（計畫席 10-16 再裁）。
 * 家長登入後送的申請不在這裡 —— 管理端還沒有地方處理它們（計畫席另開單）。
 */
export async function notifyNewApplication(
  supabase: SupabaseClient,
  input: {
    readonly orgId: string;
    readonly applicationId: string;
    readonly kind: 'enrollment' | 'trial';
    readonly studentName: string;
    readonly classIds?: readonly string[];
    readonly courseIds?: readonly string[];
  },
): Promise<void> {
  try {
    const campusIds = new Set<string>();
    // 報名指到班、試聽指到課程；分校取它們自己的（跨分校就是聯集，同管理端的可見判準）
    if (input.classIds?.length) {
      const { data, error } = await supabase
        .from('classes')
        .select('campus_id')
        .eq('org_id', input.orgId)
        .in('id', input.classIds);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as Array<{ campus_id: string }>) campusIds.add(r.campus_id);
    }
    if (input.courseIds?.length) {
      const { data, error } = await supabase
        .from('courses')
        .select('campus_id')
        .eq('org_id', input.orgId)
        .in('id', input.courseIds);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as Array<{ campus_id: string }>) campusIds.add(r.campus_id);
    }
    if (campusIds.size === 0) return;

    const admins = await adminsForCampuses(supabase, input.orgId, [...campusIds], {
      permission: 'manage_students',
    });
    const label = input.kind === 'enrollment' ? '報名' : '試聽';
    await notify(
      supabase,
      admins.map((userId) => ({
        orgId: input.orgId,
        userId,
        role: 'admin' as const,
        kind: 'application_received' as const,
        dedupeKey: `application:${input.applicationId}`,
        title: `新的${label}申請`,
        body: `${input.studentName} 送出${label}申請`,
        url: '/admin/applications',
      })),
    );
  } catch (err) {
    console.error('[notify] 申請通知失敗（申請已寫入）:', err instanceof Error ? err.message : err);
  }
}
