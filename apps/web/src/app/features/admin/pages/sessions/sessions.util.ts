import { parseISO } from 'date-fns';

/**
 * 從別頁（目前只有儀表板的未點名卡）連過來時，query params 解出來的篩選。
 * 對照 `dashboard.util.ts` 的 `pendingAttendanceQuery`——那支決定儀表板帶
 * 什麼參數過來，這支負責讀懂它。兩邊各自是這個「跨頁篩選」契約的一半，
 * 不是同一份東西喊兩次名字。
 */
export interface IncomingAttendanceFilter {
  readonly dateFrom: Date;
  readonly dateTo: Date;
  readonly attendanceTaken: boolean;
  /** 只篩「已經上完」的課堂——見 `dashboard.util.ts` 的 `pendingAttendanceQuery` */
  readonly endedOnly: boolean;
}

/**
 * `null` 代表「沒有帶這組篩選」——`dateFrom`/`dateTo`/`attendanceTaken` 三個
 * 缺一個就整組不採用，不要半套（例如只有 `attendanceTaken` 沒有日期區間，
 * 套用了會篩出範圍錯誤的結果，比完全不篩更容易被誤讀成「就是這樣」）。
 * `endedOnly` 不在這個「缺一不可」的名單裡——它是可選的加強條件，沒帶就是
 * false，不影響其餘三個欄位是否成立。
 */
export function parseAttendanceQueryParams(
  params: Readonly<Record<string, string>>,
): IncomingAttendanceFilter | null {
  const { dateFrom, dateTo, attendanceTaken, endedOnly } = params;
  if (!dateFrom || !dateTo || attendanceTaken === undefined) return null;

  return {
    dateFrom: parseISO(dateFrom),
    dateTo: parseISO(dateTo),
    attendanceTaken: attendanceTaken === 'true',
    endedOnly: endedOnly === 'true',
  };
}
