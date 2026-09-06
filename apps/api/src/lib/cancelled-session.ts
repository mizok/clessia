/**
 * 停課的課堂 —— 這條規則的**唯一定義**。
 *
 * 停課只改 `sessions.status`：那筆 `events` 列留著、`sessions.event_id` 還指著它，
 * 所以每一個「撈當天／某區間的 event」的寫入路徑都會**照樣撈到停課的課堂**，
 * 除非它自己記得看 status。目前有三個寫入點都要看：
 *
 * | 寫入點 | 觸發 |
 * | --- | --- |
 * | `lib/enrolled-events.ts` | 到班掃碼寫 `present`（#485 1(a)） |
 * | `routes/leaves.ts` | 建立／編輯請假寫 `on_leave`（#502） |
 * | `routes/enrollments.ts` | 建立／編輯報名時回補既有假單（#568） |
 *
 * 前兩處原本各有一份自己的實作，`enrolled-events.ts` 的註解寫著
 * **「出現第三份的時候再收斂」** —— #568 就是第三份，所以收斂在這裡。
 *
 * ---
 *
 * ⚠️ **沒帶 `status` 就視為「要寫」**，這個方向是刻意的。
 *
 * 呼叫端漏掉 `select('status')` 時，行為退回**照舊寫**，而不是「全部不寫」。
 * 反過來設計的話，**一次漏 select 會讓整批出勤紀錄靜靜消失而且沒有任何訊號** ——
 * 那比多寫幾筆難發現得多。**在兩個錯誤之間選會被發現的那個。**
 *
 * 代價是這道守衛**依賴呼叫端真的撈了 `status`**，而少撈不會報錯、只會讓過濾
 * 靜靜地什麼都不做。所以三個呼叫端的 `select` 旁邊都有註解指回這裡。
 */
export interface CancellableSession {
  readonly status?: string | null;
}

export function isCancelledSession(session: CancellableSession): boolean {
  return session.status === 'cancelled';
}

/**
 * PostgREST 的巢狀關聯**可能回物件也可能回陣列**（實測 `events` 配
 * `sessions!inner(...)` 回的是**陣列**），所以兩種形狀都要收。
 */
export function toSessionRows<T>(sessions: T | T[] | null | undefined): T[] {
  return Array.isArray(sessions) ? sessions : sessions ? [sessions] : [];
}
