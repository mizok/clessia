/**
 * 「這堂課那天有幾場考試」的索引。
 *
 * 課堂列表要在格子上標一個小考記號，而考試不是掛在 session 上的 ——
 * `academy_exams` 有 `exam_date`，透過 `academy_exam_classes` 對到班級。所以配對鍵是
 * **(班級, 日期)**，不是 session id。同一班同一天有兩場（不同科目）就是 2。
 *
 * **不看 `status`。** draft 也算：老師先排好下週的考試，課表上就該看得到；closed 的
 * 過去那天也確實考過。專案其他地方也沒有把 draft 當隱藏（`academy-exams` 的列表照回）
 * —— 在這裡自己發明一條過濾規則，只會讓「明明排了卻沒顯示」變成沒人查得出來的怪事。
 */
export function sessionExamKey(classId: string, date: string): string {
  return `${classId}|${date}`;
}

export function countExamsBySession(
  rows: ReadonlyArray<{ class_id: string; exam_date: string }>,
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (!row.class_id || !row.exam_date) continue;
    const key = sessionExamKey(row.class_id, row.exam_date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}
