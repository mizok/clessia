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
  /**
   * 勾選綁定的堂次（#1114，`leave_request_sessions`）。**非空就只蓋這幾堂**，日期區間與時間窗不再算數；
   * 空陣列＝舊語意（整天／單日時間窗）。**必填**：漏撈綁定會把一張只請一堂的假讀成整天，
   * 所以讓呼叫端編不過，而不是靜靜退回舊語意。
   */
  boundSessions: ReadonlyArray<{ sessionId: string; date: string }>;
}

export interface SessionWindow {
  /** 指名哪一堂；`null`＝日層級查詢（日到班），綁定型假只要當天有綁定堂就算蓋到 */
  sessionId: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
}

/**
 * 綁定堂次的 embed。**回應裡有 `sessionIds` 的 select 都要帶它**（`toLeaveResponse` 從它讀）——
 * `select('*')` 不會帶出關聯表，漏了它綁定型的假在列表與 PATCH 回應裡是 `sessionIds: []`（#1150 實打）。
 */
export const LEAVE_SESSIONS_EMBED = 'leave_request_sessions(session_id, sessions(session_date))';

/** 讀請假單時要一起撈的欄位 —— 綁定堂次與它的日期都在 embed 裡 */
export const LEAVE_WINDOW_COLUMNS = `start_date, end_date, start_time, end_time, ${LEAVE_SESSIONS_EMBED}`;

export function toLeaveWindow(row: Record<string, unknown>): LeaveWindow {
  const bound = (row['leave_request_sessions'] ?? []) as Array<{
    session_id: string;
    sessions: { session_date: string } | Array<{ session_date: string }> | null;
  }>;
  return {
    startDate: row['start_date'] as string,
    endDate: row['end_date'] as string,
    startTime: (row['start_time'] as string | null) ?? null,
    endTime: (row['end_time'] as string | null) ?? null,
    boundSessions: bound.map((b) => ({
      sessionId: b.session_id,
      date: (Array.isArray(b.sessions) ? b.sessions[0] : b.sessions)?.session_date ?? '',
    })),
  };
}

export function leaveCoversSession(leave: LeaveWindow, session: SessionWindow): boolean {
  if (leave.boundSessions.length > 0) {
    return session.sessionId
      ? leave.boundSessions.some((b) => b.sessionId === session.sessionId)
      : leave.boundSessions.some((b) => b.date === session.date);
  }

  if (session.date < leave.startDate || session.date > leave.endDate) return false;

  const isSingleDay = leave.startDate === leave.endDate;
  if (!isSingleDay || !leave.startTime || !leave.endTime) return true;
  if (!session.startTime || !session.endTime) return true;

  // 半開區間重疊：[a1,a2) 與 [b1,b2) 相交 ⇔ a1 < b2 且 b1 < a2。
  // 用 `<` 而不是 `<=`：請假到 12:00、課堂 12:00 開始，那是接續不是重疊。
  return leave.startTime < session.endTime && session.startTime < leave.endTime;
}

/**
 * 兩張假算不算重疊（#1114 裁定 4）—— 「請假不得重疊」那條不變量的判準。
 *
 * - 都綁定：**共用同一堂**才算（同一天不同堂可以各一張）
 * - 一綁一整天：綁定堂有任一天落在整天型的區間裡就算（整天已經蓋了那堂）
 * - 都沒綁定：日期區間有交集就算（端點日相同也算 —— 接力假會讓 roster 的聚合騙人，見 leaves.spec）
 *
 * 於是**每一堂最多被一張假蓋到**，roster「一堂一張假」的前提不變。
 */
export function leavesConflict(a: LeaveWindow, b: LeaveWindow): boolean {
  const aBound = a.boundSessions.length > 0;
  const bBound = b.boundSessions.length > 0;
  if (aBound && bBound) {
    return a.boundSessions.some((x) => b.boundSessions.some((y) => y.sessionId === x.sessionId));
  }
  if (aBound || bBound) {
    const [bound, whole] = aBound ? [a, b] : [b, a];
    return bound.boundSessions.some((x) => x.date >= whole.startDate && x.date <= whole.endDate);
  }
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}
