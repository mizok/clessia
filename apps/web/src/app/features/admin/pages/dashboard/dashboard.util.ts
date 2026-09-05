import { format, subDays } from 'date-fns';

/**
 * 未點名課堂卡片的篩選語意，**唯一的定義來源**——儀表板算數字、以及卡片連到
 * 課堂管理頁時要帶的 `queryParams`，都從這支函式產生。同一份定義餵給兩邊，
 * 才不會出現「卡片說 15、落地頁顯示別的數字」（P1-6：kb/wiki/architecture/
 * admin-todo-alerts.md）。
 *
 * `attendanceTaken=false` + `endedOnly=true` 一次表達「沒點名而且已經上完」——
 * 這兩個條件以前被迫拆成「昨天以前伺服器算」+「今天前端逐筆濾」兩段，
 * 拆的原因只是 API 表達不出「已結束」，不是業務上真的有兩段（#368 補上
 * `endedOnly` 之後，這支函式把兩段收回一份）。
 *
 * `dateTo` 特意含今天——`endedOnly` 已經排除了今天還沒上完的課，不需要
 * 前端自己再挖掉今天。
 */
export function pendingAttendanceQuery(
  now: Date,
  lookbackDays: number,
): { dateFrom: string; dateTo: string; attendanceTaken: false; endedOnly: true } {
  return {
    dateFrom: format(subDays(now, lookbackDays), 'yyyy-MM-dd'),
    dateTo: format(now, 'yyyy-MM-dd'),
    attendanceTaken: false,
    endedOnly: true,
  };
}
