/**
 * 這張請假單蓋不蓋得到這一堂課。
 *
 * **為什麼要用推導的，而不是靠 `attendance_records` 裡的 `on_leave`：**
 * 建立請假時 `leaves.ts` 會把當時**已經存在的** event 寫成 `on_leave`，但出勤事件是
 * **懶生成的** —— `ensureAttendanceSessionEvents` 在有人查課堂列表時才補建。
 * 所以「先請假、之後那堂課才生成 event」的順序下，連動一筆都寫不到，
 * 而那正是最常見的順序（家長提前請假）。
 *
 * 讀取時推導不怕時序：不管 event 什麼時候生出來，roster 都會去看當天有沒有假。
 *
 * **時間的處理刻意保守**（寧可漏標也不要誤標）：目前沒有銷假動作
 * （「請假的學生臨時出現」是另一張單），所以誤標成請假的學生，老師沒有辦法把他改回來。
 *
 * - 請假只有日期沒有時間 → 整天，當天的課全部蓋到
 * - **單日**請假且有起訖時間 → 跟課堂時間做重疊判斷
 * - **跨日**請假即使帶了時間 → 當整天處理（時間套在哪一天沒有定義，
 *   `getLeaveValidationError` 也只在單日的情況檢查時間順序）
 * - 課堂沒有起訖時間 → 當整天，同一天的假就蓋得到
 */
export interface LeaveWindow {
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
}

export interface SessionWindow {
  date: string;
  startTime: string | null;
  endTime: string | null;
}

export function leaveCoversSession(leave: LeaveWindow, session: SessionWindow): boolean {
  if (session.date < leave.startDate || session.date > leave.endDate) return false;

  const isSingleDay = leave.startDate === leave.endDate;
  if (!isSingleDay || !leave.startTime || !leave.endTime) return true;
  if (!session.startTime || !session.endTime) return true;

  // 半開區間重疊：[a1,a2) 與 [b1,b2) 相交 ⇔ a1 < b2 且 b1 < a2。
  // 用 `<` 而不是 `<=`：請假到 12:00、課堂 12:00 開始，那是接續不是重疊。
  return leave.startTime < session.endTime && session.startTime < leave.endTime;
}
