import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 一個科目被哪些表用著 —— **唯一定義**，`routes/subjects.ts` 的列表（批次算給
 * 每個科目看）與刪除守門（單一科目，fail-closed）共用同一支查詢，不是各寫
 * 一份「怎麼算用量」。
 *
 * `courses.subject_id` 是 `ON DELETE RESTRICT`，DB 本身就會擋刪除；
 * `academy_exams.subject_id` 是 `ON DELETE SET NULL`——**DB 不會擋，會安靜
 * 把欄位清掉**，這支應用層檢查是這個關聯唯一的防線，不是第二道
 * （M8 稽核發現：舊版只查 `courses`，`academy_exams` 完全沒查）。
 *
 * 查詢失敗一律回 `error`，呼叫端 fail closed：查不到答案不能當「沒有用到」，
 * 那正是 `count ?? 0` 誤判的陷阱。
 */
export async function countSubjectUsage({
  supabase,
  orgId,
  table,
  subjectIds,
}: {
  readonly supabase: SupabaseClient;
  readonly orgId: string;
  readonly table: string;
  readonly subjectIds: readonly string[];
}): Promise<{ readonly counts: ReadonlyMap<string, number>; readonly error: unknown }> {
  if (subjectIds.length === 0) {
    return { counts: new Map(), error: null };
  }

  const { data, error } = await supabase
    .from(table)
    .select('subject_id')
    .eq('org_id', orgId)
    .in('subject_id', subjectIds);

  if (error) {
    return { counts: new Map(), error };
  }

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ subject_id: string | null }>) {
    if (!row.subject_id) continue;
    counts.set(row.subject_id, (counts.get(row.subject_id) ?? 0) + 1);
  }
  return { counts, error: null };
}
