/**
 * 課堂列表的人數統計 —— **在記憶體裡算，不是每堂各發一次查詢**。
 *
 * 原本的實作對每一堂課各發兩支查詢（`attendance_records` 一支、`enrollments` 的
 * count 一支）。儀表板一次要兩份課堂列表（今日 + 回溯 7 天，`pageSize: 100`），
 * 所以最壞情況是 **400 次額外的往返**，全部從 Worker 打到 Supabase。
 *
 * 空資料庫時是 0 次（所以它不是「空 DB 也很慢」的原因），但**有資料之後這是最大的
 * 一塊** —— 而且它隨著課堂數線性成長，正好是「用得越多越慢」的那種退化。
 *
 * 改成兩支批次查詢（`.in('event_id', ...)` 與 `.in('class_id', ...)`）之後，
 * 每筆課堂的計數在這裡算。
 */

export interface EnrollmentRange {
  classId: string;
  effectiveFrom: string;
  /** null = 還在讀 */
  effectiveTo: string | null;
}

/**
 * 某一天這個班有幾個在籍學生。
 *
 * `date` 是 null 時（課堂還沒排定時間）**不套生效區間**，只依班級算 ——
 * 原本的實作會把 null 丟進 `.lte('effective_from', null)`，那個查詢的結果沒有人說得準。
 */
export function countEnrolledOn(
  enrollments: readonly EnrollmentRange[],
  classId: string,
  date: string | null,
): number {
  return enrollments.filter((row) => {
    if (row.classId !== classId) return false;
    if (date === null) return true;
    if (row.effectiveFrom > date) return false;
    // 結束當天還算在籍
    return row.effectiveTo === null || row.effectiveTo >= date;
  }).length;
}

export interface AttendanceTally {
  presentCount: number;
  onLeaveCount: number;
  absentCount: number;
}

/**
 * 出勤記錄依 event 分組計數。
 *
 * 沒有記錄的 event **不會出現在回傳的 map 裡** —— 呼叫端要自己給零值。
 * 回一個「全 0」的預設物件會讓「這堂沒點名」跟「這堂全缺席」長得一樣。
 */
export function tallyAttendance(
  records: ReadonlyArray<{ eventId: string; status: string }>,
): Map<string, AttendanceTally> {
  const tally = new Map<string, AttendanceTally>();

  for (const record of records) {
    let entry = tally.get(record.eventId);
    if (!entry) {
      entry = { presentCount: 0, onLeaveCount: 0, absentCount: 0 };
      tally.set(record.eventId, entry);
    }

    // 未知狀態不計入任何一欄。enum 只有三種，多出來的值是資料問題不是新分類
    if (record.status === 'present') entry.presentCount += 1;
    else if (record.status === 'on_leave') entry.onLeaveCount += 1;
    else if (record.status === 'absent') entry.absentCount += 1;
  }

  return tally;
}
