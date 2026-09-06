import { format, subDays } from 'date-fns';

import type { AttendanceSessionStatus } from '../../../../core/attendance.service';

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
 *
 * `statuses` **明著送，不靠任何一端的預設值**（#456）。在這之前卡片的數字吃
 * `GET /api/attendance/sessions` 的 API 預設（`attendance.ts` 的
 * `?? ['scheduled','completed']`），落地頁吃 web 的 `DEFAULT_STATUSES`——
 * 兩份各自獨立的清單，今天相等純粹是因為兩個人各自挑了同一組。任一邊改預設，
 * 卡片說 15、點進去 12，**而兩個數字都看起來合理，沒有東西會紅**。
 * 明著送之後這裡是唯一的定義，落地頁從 query param 讀它（`sessions.util.ts`
 * 的 `parseAttendanceQueryParams`），兩邊變成同一份定義的兩個消費端。
 *
 * 排除 `cancelled` 是刻意的：停課的課堂不會發生，也不補建出勤事件，
 * 本來就不該出現在「未點名」裡。
 */
export function pendingAttendanceQuery(
  now: Date,
  lookbackDays: number,
): {
  dateFrom: string;
  dateTo: string;
  attendanceTaken: false;
  endedOnly: true;
  statuses: AttendanceSessionStatus[];
} {
  return {
    dateFrom: format(subDays(now, lookbackDays), 'yyyy-MM-dd'),
    dateTo: format(now, 'yyyy-MM-dd'),
    attendanceTaken: false,
    endedOnly: true,
    statuses: ['scheduled', 'completed'],
  };
}
