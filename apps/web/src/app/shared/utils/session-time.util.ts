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
