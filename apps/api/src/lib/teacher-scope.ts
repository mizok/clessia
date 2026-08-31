import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 聯絡簿與教務日誌共用的範圍規則：管理員不受限，老師只能碰自己固定任課的班。
 *
 * **範圍限制放在伺服器，而且不看請求怎麼說** —— 前端隱藏不構成授權（c1）。
 * 「自己任課」取 `schedules.teacher_id`（固定任課）而不是 `sessions.teacher_id`
 * （含代課），理由見 kb/wiki/architecture/teacher-students-view.md。
 *
 * `routes/students/teacher-scope.ts` 與 `routes/attendance/teacher-scope.ts` 是同一個模式的
 * 前兩份。沒有把三份合併成一份，是因為那兩份各自綁著自己路由的輸入型別
 * （`taughtByMe` 之類），合併要動到兩個已經在跑的功能；這一份是新的兩個 feature 共用，
 * 放在 lib/ 下。真要收斂成一份的時候，這裡是收斂的目標。
 */
export interface TeachingScopeInput {
  readonly roles: readonly string[];
  readonly ownStaffId: string | null;
}

export type TeachingScope = { teacherStaffId: string | null } | { forbidden: true };

export function resolveTeachingScope(input: TeachingScopeInput): TeachingScope {
  if (input.roles.includes('admin')) {
    return { teacherStaffId: null };
  }

  if (input.roles.includes('teacher')) {
    // 沒有 staff 列就無法安全地縮限，放行等於把全校的紀錄交出去
    return input.ownStaffId ? { teacherStaffId: input.ownStaffId } : { forbidden: true };
  }

  return { forbidden: true };
}

/**
 * 查詢失敗一律往上丟，**不吞成空結果**。
 *
 * 這個檔案原本三支查詢都寫 `const { data } = await ...` 然後 `data ?? []` ——
 * 於是 `taughtClassIds` 對沒有 `org_id` 欄位的 `schedules` 下條件時，PostgREST 回的
 * 42703 被安靜地變成「這位老師沒有任何班」，老師端的聯絡簿、教務日誌、成績、校內考、
 * 段考**全部回空**而沒有任何跡象。失敗方向是安全的（回空不是回全），但**無聲的失敗
 * 比錯誤更貴**：它看起來就像「本來就沒有資料」。
 *
 * 丟出去之後由 `index.ts` 的 `onError` 變成 500。老師看到錯誤總比看到空白好 ——
 * 空白他會以為是自己沒被排課。
 */
function unwrap<T>(
  result: { data: T[] | null; error: { message: string } | null },
  what: string,
): T[] {
  if (result.error) throw new Error(`${what}失敗：${result.error.message}`);
  return result.data ?? [];
}

/**
 * 從請求脈絡解析範圍：管理員不查 staff（不受限所以不必查），老師才查。
 */
export async function loadTeachingScope(
  supabase: SupabaseClient,
  params: { orgId: string; userId: string; roles: readonly string[] },
): Promise<TeachingScope> {
  if (params.roles.includes('admin')) {
    return resolveTeachingScope({ roles: params.roles, ownStaffId: null });
  }

  const { data, error } = await supabase
    .from('staff')
    .select('id')
    .eq('user_id', params.userId)
    .eq('org_id', params.orgId)
    .maybeSingle();

  // 查不到 staff 列與「查詢本身壞了」是兩件事：前者是 403（他不是老師），
  // 後者吞掉的話老師會被當成沒有身分而看到 403，然後沒有人知道為什麼
  if (error) throw new Error(`查詢教職員身分失敗：${error.message}`);

  return resolveTeachingScope({
    roles: params.roles,
    ownStaffId: (data?.['id'] as string | undefined) ?? null,
  });
}

/** 這位老師固定任課的班級 id。空陣列＝他沒有任何班，呼叫端該回空結果而不是全部。 */
export async function taughtClassIds(
  supabase: SupabaseClient,
  orgId: string,
  teacherStaffId: string,
): Promise<string[]> {
  // **`schedules` 沒有 `org_id` 欄位**（`20260223000001_create_classes.sql`）——
  // 對它下 `.eq('org_id', ...)` 是 42703（本機 PostgREST 實測：
  // `column schedules.org_id does not exist`）。org 的界線走 `classes`。
  const result = await supabase
    .from('schedules')
    .select('class_id, classes!inner(org_id)')
    .eq('classes.org_id', orgId)
    .eq('teacher_id', teacherStaffId);

  return Array.from(
    new Set(
      unwrap<Record<string, unknown>>(result, '查詢任課班級').map((r) => r['class_id'] as string),
    ),
  );
}

/** 這位老師固定任課班級裡的在籍學生 id。 */
export async function taughtStudentIds(
  supabase: SupabaseClient,
  orgId: string,
  teacherStaffId: string,
): Promise<string[]> {
  const classIds = await taughtClassIds(supabase, orgId, teacherStaffId);
  if (classIds.length === 0) return [];

  const result = await supabase
    .from('enrollments')
    .select('student_id')
    .eq('org_id', orgId)
    .in('class_id', classIds);

  return Array.from(
    new Set(
      unwrap<Record<string, unknown>>(result, '查詢任課學生').map((r) => r['student_id'] as string),
    ),
  );
}
