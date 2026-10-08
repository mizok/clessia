import type { CampusScope } from './campus-scope';

/**
 * 帳單的分校範圍（#1381）。**判準只有一份，住在這裡** —— 列表、單筆、彙總、六支寫入全走它。
 *
 * 受限的管理員（`scope` 不是 null）要**兩條都成立**才看得到、改得到一張帳單：
 *
 * 1. **學生在範圍內**：學生任一報名的班的 `campus_id` 在範圍內。
 *    ⚠️ 這跟 `routes/students.ts:367` 學生列表的判準是**同一條、算了第二次** ——
 *    那裡寫著「算兩次就會分岔一次」。改其中一邊時兩邊一起改（收斂記在 #1374）。
 * 2. **有班的明細全在範圍內**：明細 `enrollment → classes.campus_id` 只要有一筆在範圍外就不給
 *    （同 `routes/reports.ts:105` 的「沾到就不能看」—— 否則跨校帳單是看見別校金額的側管道）。
 *
 * **跟 reports 刻意差一處：沒有班的明細（餐費、調整）不讓整張失格。** 餐費的 `enrollment_id`
 * 一律是 null（`billing-runs.ts`），照抄 reports 的話受限者看不到自己學生所有帶餐費的帳單，
 * 連剛開的空帳單都看不到。「推不出分校」的顧慮由第 1 條補上（計畫席 10-08 gate 採納）。
 */

/**
 * 判準要的欄位，接在帳單 select 後面。用 alias 是因為主 select 已經有 `students(name)` 與
 * `invoice_items(...)`，同一個關聯不能不帶別名 embed 兩次。
 */
export const INVOICE_SCOPE_EMBED =
  ', scope_student:students(enrollments(classes(campus_id))),' +
  ' scope_items:invoice_items(enrollments(classes(campus_id)))';

type Row = Record<string, unknown>;

// `?? null` 不能省：沒有報名的明細（餐費）embed 回 null，可選鏈出來是 undefined，
// 而下面判「沒有班」比的是 null —— 少了它，帶餐費的帳單整張被判成範圍外
const campusOf = (enrollment: unknown): string | null =>
  (((enrollment as Row | null)?.['classes'] as Row | null)?.['campus_id'] as string | null) ?? null;

/** 學生的報名（`students(enrollments(classes(campus_id)))` 那一層）有沒有任一筆在範圍內 */
export function studentInScope(enrollments: unknown, scope: CampusScope): boolean {
  if (scope === null) return true;
  return ((enrollments as unknown[] | null) ?? []).some((enrollment) => {
    const campusId = campusOf(enrollment);
    return campusId !== null && scope.includes(campusId);
  });
}

/** 一批明細／報名的班：有分校的全在範圍內（沒有班的不算） */
export function enrollmentsInScope(enrollments: readonly unknown[], scope: CampusScope): boolean {
  if (scope === null) return true;
  return enrollments.every((enrollment) => {
    const campusId = campusOf(enrollment);
    return campusId === null || scope.includes(campusId);
  });
}

/** 帳單列（select 帶了 `INVOICE_SCOPE_EMBED`）在不在範圍內 */
export function invoiceInScope(row: Row, scope: CampusScope): boolean {
  if (scope === null) return true;
  const student = row['scope_student'] as Row | null;
  const items = (row['scope_items'] as Row[] | null) ?? [];
  return (
    studentInScope(student?.['enrollments'], scope) &&
    enrollmentsInScope(
      items.map((item) => item['enrollments']),
      scope,
    )
  );
}
