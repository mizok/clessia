/**
 * 銷假：讓某一張請假單不再蓋到某一天。
 *
 * **業務決定（2026-09-03 使用者定案）：銷假就是刪掉請假單，不留痕作廢。**
 * 但請假可以是多天的，而老師按下的是「這個學生**今天**到了」—— 把一張三天的假整張
 * 刪掉，等於連家長還沒撤銷的後兩天也一起沒了。所以刪的單位是**那一天**，
 * 只有「整張假就是那一天」時才真的刪掉整張。
 *
 * 今天卡在區間中間時**截到昨天**（後面的日子一起沒了），而不是切成兩張：
 * 切兩張會新增一列請假單，跟「銷假＝刪除」的簡潔相反，稽核也更難讀。
 * 代價是後段被連坐，所以回傳 `droppedAfter` 讓呼叫端可以明白告訴老師。
 */
export type CancelLeaveAction =
  | { kind: 'delete' }
  | { kind: 'shrink'; startDate: string; endDate: string; droppedAfter: string | null }
  | { kind: 'none' };

/**
 * 日曆上的前後一天。**用 UTC 走** —— 這裡的日期是字串上的 `YYYY-MM-DD`，
 * 拿本地時區推進會在夏令時或跨時區部署時差一天。
 */
export function shiftDateString(date: string, days: number): string {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

export function cancelLeaveForDate(
  leave: { startDate: string; endDate: string },
  date: string,
): CancelLeaveAction {
  const nextDay = (value: string) => shiftDateString(value, 1);
  const previousDay = (value: string) => shiftDateString(value, -1);

  // 這一天本來就沒被蓋到 —— 不該動它。呼叫端要把這種情況當成「沒有假可以銷」
  if (date < leave.startDate || date > leave.endDate) return { kind: 'none' };

  const startsToday = leave.startDate === date;
  const endsToday = leave.endDate === date;

  if (startsToday && endsToday) return { kind: 'delete' };

  if (startsToday) {
    // 今天開始、之後才結束 → 從明天開始。學生今天到了，不代表明天的假也不算數
    return { kind: 'shrink', startDate: nextDay(date), endDate: leave.endDate, droppedAfter: null };
  }

  // 之前開始 → 截到昨天。今天之後還有的話，那些日子一起被取消，回報出去
  return {
    kind: 'shrink',
    startDate: leave.startDate,
    endDate: previousDay(date),
    droppedAfter: endsToday ? null : leave.endDate,
  };
}
