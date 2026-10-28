import type { SupabaseClient } from '@supabase/supabase-js';

import { isScheduleCurrentOrUpcoming, scheduleRangeOf } from './schedule-effective';
import { getCurrentTaipeiDateString } from './taipei-date';

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

/** 任期的一段（兩端都含） */
export interface Term {
  readonly from: string;
  readonly to: string;
}

/**
 * **任課判定看日期**（#2049，計畫席 10-28 裁定 R2）。授權的判準只有這一份，15 個呼叫端都走它：
 *
 * - **現任或將任**（這班有一列今天有效或還沒生效的時段）＝整班、全部日期，讀寫都可以。
 *   跟看日期以前一樣 —— 接手的老師要看得到前任的日誌、成績、聯絡簿
 * - **前任**（這班只剩已經結束的時段）＝**只讀、只限自己任期內的日期**；沒有日期脈絡的
 *   （名冊、學生詳情、以學生為單位的成績）一律看不到
 * - 其他＝無權
 *
 * 星期不細分（一班兩個時段分屬兩位老師，兩人都是現任）。前任只會從「`split` 從某天起換老師」
 * 或「`effective_to` 設成過去」來 —— PUT 原地改 `teacher_id` 不留舊列，前任本來就全失。
 */
export interface TeachingTenure {
  /** 現任或將任的班 */
  readonly current: readonly string[];
  /** 前任的班 → 任期（可能多段） */
  readonly past: ReadonlyMap<string, readonly Term[]>;
}

export type TenureOnDate = 'current' | 'past' | 'none';

export async function loadTenure(
  supabase: SupabaseClient,
  orgId: string,
  teacherStaffId: string,
  today: string = getCurrentTaipeiDateString(),
): Promise<TeachingTenure> {
  // **`schedules` 沒有 `org_id` 欄位**（`20260223000001_create_classes.sql`）——
  // 對它下 `.eq('org_id', ...)` 是 42703（本機 PostgREST 實測：
  // `column schedules.org_id does not exist`）。org 的界線走 `classes`。
  const result = await supabase
    .from('schedules')
    .select('class_id, effective_from, effective_to, classes!inner(org_id)')
    .eq('classes.org_id', orgId)
    .eq('teacher_id', teacherStaffId);

  const byClass = new Map<string, Array<Record<string, unknown>>>();
  for (const row of unwrap<Record<string, unknown>>(result, '查詢任課班級')) {
    const id = row['class_id'] as string;
    byClass.set(id, [...(byClass.get(id) ?? []), row]);
  }
  const current: string[] = [];
  const past = new Map<string, Term[]>();
  for (const [classId, rows] of byClass) {
    const ranges = rows.map(scheduleRangeOf);
    if (ranges.some((r) => isScheduleCurrentOrUpcoming(r, today))) current.push(classId);
    // 不是現任 ⇒ 每一列都已結束，`effectiveTo` 一定有值
    else
      past.set(
        classId,
        ranges.map((r) => ({ from: r.effectiveFrom, to: r.effectiveTo! })),
      );
  }
  return { current, past };
}

/** 這位老師對這班在 `date` 那天的身分。`date` 是 null＝沒有日期脈絡（前任一律 none） */
export function tenureOn(t: TeachingTenure, classId: string, date: string | null): TenureOnDate {
  if (t.current.includes(classId)) return 'current';
  const terms = t.past.get(classId);
  return date !== null && terms?.some((term) => term.from <= date && date <= term.to)
    ? 'past'
    : 'none';
}

/** 讀得到（現任，或前任任期內）。寫入只看 `current` —— 前任唯讀（裁定 b） */
export const canReadOn = (t: TeachingTenure, classId: string, date: string | null) =>
  tenureOn(t, classId, date) !== 'none';

/**
 * PostgREST `.or()` 的條件：`idColumn` 在 `current` 裡（全期），或是前任的某一段（`dateColumn` 落在任期內）。
 * 回 null＝什麼都看不到，呼叫端回空結果。列表用它而不是撈回來再濾 —— `count` 才會對。
 * ponytail: 前任每段一個 `and(...)`，段數是「卸任的班 × 換手次數」；長到 414 再改走 pg
 */
export function tenureOrFilter(
  idColumn: string,
  dateColumn: string,
  current: readonly string[],
  past: ReadonlyMap<string, readonly Term[]>,
): string | null {
  const parts = current.length > 0 ? [`${idColumn}.in.(${current.join(',')})`] : [];
  for (const [id, terms] of past) {
    for (const term of terms) {
      parts.push(
        `and(${idColumn}.eq.${id},${dateColumn}.gte.${term.from},${dateColumn}.lte.${term.to})`,
      );
    }
  }
  return parts.length > 0 ? parts.join(',') : null;
}

/**
 * 這位老師**現任或將任**的班級 id —— 沒有日期脈絡的地方、以及所有寫入用這個（前任看不到也寫不了）。
 * 空陣列＝他沒有任何班，呼叫端該回空結果而不是全部。
 */
export async function taughtClassIds(
  supabase: SupabaseClient,
  orgId: string,
  teacherStaffId: string,
): Promise<string[]> {
  return [...(await loadTenure(supabase, orgId, teacherStaffId)).current];
}

async function enrolledStudents(
  supabase: SupabaseClient,
  orgId: string,
  classIds: readonly string[],
): Promise<Array<{ student_id: string; class_id: string }>> {
  if (classIds.length === 0) return [];
  const result = await supabase
    .from('enrollments')
    .select('student_id, class_id')
    .eq('org_id', orgId)
    .in('class_id', [...classIds]);
  return unwrap(result, '查詢任課學生') as Array<{ student_id: string; class_id: string }>;
}

/** 這位老師**現任或將任**班級裡的學生 id（任何報名狀態）。沒有日期脈絡、或要寫入時用 */
export async function taughtStudentIds(
  supabase: SupabaseClient,
  orgId: string,
  teacherStaffId: string,
): Promise<string[]> {
  const classIds = await taughtClassIds(supabase, orgId, teacherStaffId);
  return [...new Set((await enrolledStudents(supabase, orgId, classIds)).map((r) => r.student_id))];
}

/**
 * 學生層級的任期（聯絡簿這種「學生 × 日期」、不帶班的資料）：在現任班的學生＝全期；
 * 只在前任班的學生＝那些班的任期。同一位學生兩邊都有，以現任為準。
 */
export async function studentTenure(
  supabase: SupabaseClient,
  orgId: string,
  t: TeachingTenure,
): Promise<{ current: string[]; past: Map<string, Term[]> }> {
  const rows = await enrolledStudents(supabase, orgId, [...t.current, ...t.past.keys()]);
  const current = new Set(
    rows.filter((r) => t.current.includes(r.class_id)).map((r) => r.student_id),
  );
  const past = new Map<string, Term[]>();
  for (const r of rows) {
    if (current.has(r.student_id)) continue;
    const terms = t.past.get(r.class_id) ?? [];
    past.set(r.student_id, [...(past.get(r.student_id) ?? []), ...terms]);
  }
  return { current: [...current], past };
}
