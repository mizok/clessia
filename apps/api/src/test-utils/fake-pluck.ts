/**
 * 家長端 spec 的 `childDb.from(...).pluck(columns, idColumn, studentId)` 替身。
 *
 * 真的 `pluck` 會套 `student_id = studentId`（見 `lib/child-db.ts`）；替身若不套，
 * 把 childId 換成別人孩子的 id spec 照樣綠，「家長只看得到自己孩子」在替身層就是假的（#1501）。
 * 列沒有 `student_id` 時視為屬於 `defaultStudentId`（既有 fixture 沒寫這欄，全是同一個孩子）。
 */
export function fakePluck(
  allRows: readonly Record<string, unknown>[],
  defaultStudentId: string,
  studentIdColumn = 'student_id',
) {
  return async (_columns: string, idColumn: string, studentId: string) => {
    const rows = allRows.filter((r) => (r[studentIdColumn] ?? defaultStudentId) === studentId);
    const ids = [...new Set(rows.map((r) => r[idColumn] as string))];
    return { rows, ids, error: null };
  };
}
