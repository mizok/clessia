import type { SupabaseClient } from '@supabase/supabase-js';

export type EnrollmentSessionPackCheck =
  | { readonly status: 'none' }
  | { readonly status: 'has-session-pack' }
  | { readonly status: 'check-failed'; readonly message: string };

export interface EnrollmentSessionPackCheckInput {
  readonly supabase: SupabaseClient;
  readonly orgId: string;
  /** 一或多筆報名 id —— 刪單筆報名傳一個，刪整班傳該班底下全部報名 id */
  readonly enrollmentIds: readonly string[];
}

/**
 * 這些報名底下是否已經有已購買的堂數包（session_packs）。
 *
 * 堂數包代表家長已付費，但學生可能還沒上過任何一堂課 —— 這正是
 * `checkEnrollmentAttendance`（查出勤）與 classes.ts 的「有無過去課堂」檢查
 * 都會放行的組合：零出勤、零過去課堂，看起來「這筆報名從沒發生過」，
 * 但 `session_packs.enrollment_id` 上掛著 `ON DELETE CASCADE`
 * （見 20260829120000_create_invoices_payments.sql），刪報名會把已收費的
 * 堂數包一起靜靜刪掉（M8 稽核發現）。
 *
 * 跟 `checkEnrollmentAttendance` 同一種 fail-closed 形狀：查不到答案一律
 * `check-failed`，呼叫端要當成「不准刪」，不能把 `count ?? 0` 當 0。
 *
 * **`enrollments.ts` 的單筆刪除與 `classes.ts` 的整班刪除都呼叫這一支** ——
 * 不要各自重寫一份查詢，那樣兩邊遲早會漂移。
 */
export async function checkEnrollmentSessionPacks({
  supabase,
  orgId,
  enrollmentIds,
}: EnrollmentSessionPackCheckInput): Promise<EnrollmentSessionPackCheck> {
  const uniqueIds = Array.from(new Set(enrollmentIds));
  if (uniqueIds.length === 0) {
    return { status: 'none' };
  }

  const { count, error } = await supabase
    .from('session_packs')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .in('enrollment_id', uniqueIds);

  if (error) {
    return { status: 'check-failed', message: error.message };
  }

  return (count ?? 0) > 0 ? { status: 'has-session-pack' } : { status: 'none' };
}
