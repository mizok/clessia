/**
 * 「這堂課上完了沒」—— 跨頁共用的單一定義。
 *
 * **為什麼要共用**：儀表板的「漏點名」卡與課堂管理的狀態標籤問的是同一個問題，
 * 兩邊各寫一份的話會對同一件事說不一樣的話（儀表板說 6 堂沒點名、課堂頁標 8 堂）。
 * `day-timeline` 是第三個使用者。
 *
 * **不綁 domain 型別**：`EventSessionSummary.eventDate` 與 `Session.sessionDate` 欄位名
 * 不同，所以吃最小結構介面，呼叫端各自適配一行。
 */

export interface SessionTimeLike {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:mm`，可為 null */
  startTime: string | null;
  /** `HH:mm`，可為 null */
  endTime: string | null;
}

/**
 * 這堂課在 `now` 之前結束了嗎。
 *
 * 三個邊界，每一個都會在真實資料上出現：
 *
 * 1. **今天晚上的課早上不算結束** —— 這是這個函式存在的理由。只比日期的話，
 *    晚上七點的課從一早就會被標成「該點名而沒點」，那是誤報。
 * 2. **沒有結束時間 → 等這一天過完才算結束**。無從判斷當天那堂上完了沒，
 *    所以當天內保守回 false（假警示會讓人不再相信這個標記）；但隔天就一定上完了，
 *    永遠回 false 會讓沒填時間的課永遠不被追。
 * 3. **跨午夜的課結束在隔天** —— `endTime < startTime` 就是跨午夜，
 *    不然 23:00–01:00 的課會被當成「凌晨一點就結束了」，比開始時間還早。
 */
export function hasSessionEnded(session: SessionTimeLike, now: Date): boolean {
  const end = new Date(`${session.date}T00:00:00`);

  if (!session.endTime) {
    end.setDate(end.getDate() + 1);
    return end.getTime() <= now.getTime();
  }

  const [hour, minute] = session.endTime.split(':').map(Number);
  end.setHours(hour ?? 0, minute ?? 0, 0, 0);

  if (session.startTime && session.endTime < session.startTime) {
    end.setDate(end.getDate() + 1);
  }

  return end.getTime() <= now.getTime();
}

/**
 * 今天的本地日期（`YYYY-MM-DD`）。
 *
 * **不要用 `new Date().toISOString().slice(0, 10)`** —— 那給的是 **UTC** 日期。
 * 在 UTC+8，每天 00:00–08:00 它會回傳**前一天**：
 *
 * ```
 * 本地 2026-08-31 00:30  →  toISOString() = "2026-08-30T16:30:00Z"  →  "2026-08-30" ✗
 * ```
 *
 * 後果是真實的：`session-list` 的「這堂課是未來的嗎」在半夜會把**今天**的課judged
 * 成未來，標籤顯示「未開放點名」；`sessions.page` 的「管理出勤」選項會被 disable。
 * 測試踩到同一個坑時更難查 —— 它每天只紅 8 小時，白天重跑就綠了。
 *
 * 這個函式與 `hasSessionEnded` 用同一個基準（本地時間），兩者必須一致：
 * 一個判「今天是哪天」、一個判「這堂課上完了沒」，基準不同就會互相矛盾。
 */
export function todayLocal(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * 這堂課在 `now` 之前開始了嗎。
 *
 * 給「該做卻還沒做」這類判斷用的：課都開始了還沒指派老師，那是積欠；
 * 還沒開始的話它只是還沒輪到。
 *
 * **沒有開始時間 → 回 false（還沒開始）。** 這跟 `hasSessionEnded` 是同一個保守
 * 方向：寧可漏標也不要誤標，因為假警示會讓人不再相信這個標記。
 *
 * （曾經有一支同名概念的私有函式住在老師儀表板，null 行為相反 ——
 * 那頁在 2026-09 的「今日流」收斂裡連同它一起刪掉了。留這句是因為
 * **下次有人想加第二個「開始了沒」時，要先問 null 該回什麼**：
 * 「還沒開始」與「算進行中」是兩個不同的問題，不要因為名字像就合。）
 *
 * 也**不要**因為「呼叫端的型別保證 `startTime` 必有值」就把這個分支拿掉 ——
 * 型別是唯一一種會被別人的改動悄悄放寬的防線（放寬看起來很安全，沒人會想到
 * 要檢查下游），而那時這裡會開始靜默誤標。
 */
export function hasSessionStarted(session: SessionTimeLike, now: Date): boolean {
  if (!session.startTime) return false;

  const start = new Date(`${session.date}T00:00:00`);
  const [hour, minute] = session.startTime.split(':').map(Number);
  start.setHours(hour ?? 0, minute ?? 0, 0, 0);

  return start.getTime() <= now.getTime();
}
