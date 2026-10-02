import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * **寫入與單筆讀取的 `org_id` 範圍（c1，#966 B 批）。**
 *
 * API 用 service role，RLS 不擋 —— `org_id` 過濾是唯一的一道牆。而少寫一個
 * `.eq('org_id', orgId)` 不會報任何錯：別 org 的 id 照樣改得動、刪得掉。
 * 所以範圍收斂在這兩支有名字的函式上，harness A23 認得它們
 * （`tools/agent-harness/lib/org-scope-writes.mjs`），對 org 表的 update / delete
 * 沒帶 `inOrg` 或 `.eq('org_id')` 就紅。
 *
 * **型別即清單**：只有有 `org_id` 欄位的表能傳進 `findInOrg`。子表（`schedules`、
 * `invoice_items`…）傳進來是型別錯誤 —— 它們要驗的是父列。
 * 這份 union 由 A23 對照 migration 推導出的集合，**新增一張帶 `org_id` 的表時要一起改**。
 */
export type OrgTable =
  | 'academy_exams'
  | 'announcements'
  | 'attendance_records'
  | 'audit_logs'
  | 'billing_periods'
  | 'campuses'
  | 'class_logs'
  | 'classes'
  | 'contact_book_entries'
  | 'courses'
  | 'daily_checkins'
  | 'enrollments'
  | 'events'
  | 'fee_templates'
  | 'invoices'
  | 'leave_requests'
  | 'meal_records'
  | 'parents'
  | 'payment_records'
  | 'profiles'
  | 'receipt_counters'
  | 'schedule_changes'
  | 'school_exams'
  | 'schools'
  | 'session_packs'
  | 'sessions'
  | 'staff'
  | 'students'
  | 'subjects';

/**
 * 查詢尾端接這個 = `.eq('org_id', orgId)`，但有名字、可 grep、A23 認得。
 *
 * **寫入本身也要帶**，不能只靠前面 `findInOrg` 讀過一次 —— c1 的字面要求是寫入以
 * `org_id` 過濾，而且讀寫之間不互相信任。
 */
export function inOrg<Q extends { eq(column: string, value: string): Q }>(
  query: Q,
  orgId: string,
): Q {
  return query.eq('org_id', orgId);
}

/**
 * 以 org 範圍取單筆。**別 org 的 id 跟不存在的 id 一樣回 `null`** —— 路由回 404，
 * 不回 403：403 會告訴對方「這個 id 存在，只是不是你的」。
 *
 * 查詢失敗直接丟（500），不折成 `null` —— 「DB 掛了」跟「沒有這筆」是兩件事。
 */
export async function findInOrg(
  supabase: SupabaseClient,
  table: OrgTable,
  orgId: string,
  id: string,
  columns = 'id',
): Promise<Record<string, unknown> | null> {
  const { data, error } = await inOrg(
    supabase.from(table).select(columns).eq('id', id),
    orgId,
  ).maybeSingle();
  if (error) throw new Error(`findInOrg(${table}) failed: ${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
}

/**
 * 一批 id 裡**不屬於本 org**（含不存在）的那些 —— body 指名一批外部 id 時用（#966 B4）。
 * 回空陣列 = 全部在 org 內。查詢失敗丟例外，理由同 `findInOrg`。
 */
export async function missingInOrg(
  supabase: SupabaseClient,
  table: OrgTable,
  orgId: string,
  ids: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(ids)];
  // 直接 `.eq('org_id')` 而不是 `inOrg(…)`：`.in()` 之後的 builder 交給 inOrg 的泛型推導會撞 TS2589
  if (unique.length === 0) return [];
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .eq('org_id', orgId)
    .in('id', unique);
  if (error) throw new Error(`missingInOrg(${table}) failed: ${error.message}`);
  const found = new Set(((data ?? []) as Array<{ id: string }>).map((row) => row.id));
  return unique.filter((id) => !found.has(id));
}
