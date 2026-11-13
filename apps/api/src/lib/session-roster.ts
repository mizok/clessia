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
  /**
   * 有給就依學生去重（#953）：退班不再靠 status 排除之後，同一天退班又重報同一班的學生
   * 會有兩筆報名同時涵蓋那一天（舊的 effective_to＝新的 effective_from＝當天）
   */
  studentId?: string;
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
  const hits = enrollments.filter((row) => row.classId === classId && isEnrolledOn(row, date));
  return new Set(hits.map((row, i) => row.studentId ?? i)).size;
}

/**
 * 這筆報名在 `date` 那天涵不涵蓋得到 —— **「某一天在不在籍」的唯一定義**。
 *
 * 從 `countEnrolledOn` 裡抽出來，因為第二個問題出現了：**考試的分母是「考試日在籍的
 * 學生有幾個」，而一個學生可能同時在同一場考試的多個班裡**（數學 A 班 + 數學進階班），
 * 所以那裡要的是「不重複的學生集合」而不是「報名筆數」，`countEnrolledOn` 的
 * 筆數形狀會把同一個人算兩次。**形狀不同、規則相同** —— 規則就該只有一份。
 *
 * `date` 是 `null` 時**不套生效區間**（課堂還沒排定時間的情況）。
 *
 * **狀態前提（#953，計畫席 11-13 裁「在籍依課堂日期」做滿）**：呼叫端只濾掉 `void`（作廢＝這筆報名不算數），
 * 其餘狀態都交給生效區間判。退班一定會寫 `effective_to`（唯一入口 `PATCH /enrollments/:id/status`），
 * 所以上個月的課不會因為這個月退班而少一人，退班日之後的課也不會有他。
 * 點名名單、點名寫入驗證、課堂列表人數、作業台走這個前提；到班掃碼、請假連動、帳單批次仍是
 * `status = 'active'`（保留類，不在 #953 範圍）。
 */
export function isEnrolledOn(
  range: Pick<EnrollmentRange, 'effectiveFrom' | 'effectiveTo'>,
  date: string | null,
): boolean {
  if (date === null) return true;
  if (range.effectiveFrom > date) return false;
  // 結束當天還算在籍
  return range.effectiveTo === null || range.effectiveTo >= date;
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
  return tallyAttendanceCounts(records.map((record) => ({ ...record, count: 1 })));
}

/**
 * 同上，但吃「每個 event × 狀態有幾筆」（#1928：在 SQL 裡 `count … group by` 好，不把出勤列撈回來數，
 * 才不會被 PostgREST 的 1000 列截斷）。**狀態對應只寫在這裡一份**，`tallyAttendance` 也走這支。
 */
export function tallyAttendanceCounts(
  rows: ReadonlyArray<{ eventId: string; status: string; count: number }>,
): Map<string, AttendanceTally> {
  const tally = new Map<string, AttendanceTally>();

  for (const row of rows) {
    let entry = tally.get(row.eventId);
    if (!entry) {
      entry = { presentCount: 0, onLeaveCount: 0, absentCount: 0 };
      tally.set(row.eventId, entry);
    }

    // 未知狀態不計入任何一欄。enum 只有三種，多出來的值是資料問題不是新分類
    if (row.status === 'present') entry.presentCount += row.count;
    else if (row.status === 'on_leave') entry.onLeaveCount += row.count;
    else if (row.status === 'absent') entry.absentCount += row.count;
  }

  return tally;
}
