/**
 * 成績登錄的鍵盤動線 —— 兩份實作共用。
 *
 * 這張表長得像試算表，使用者也會這樣用它，所以 `↑` `↓` `Enter` **一律是換列**
 * 而不是改值（`p-inputnumber` 預設會把 `↓` 讀成減 1，那是最糟的巧合：
 * 看起來沒反應，其實分數少了一分）。
 *
 * 兩個呼叫端的畫面不同 —— `academy-score-editor` 是一列一個學生、
 * `score-edit-dialog` 是一列一個科目 —— 但**逐列輸入的手感必須一樣**。
 * #161 只修了前者，後者原封不動；這個 util 就是為了不要再有第三次。
 */

/** 這一列的三個欄位（分數／狀態／備註）中，分數欄要掛的標記 */
export const SCORE_ROW_ATTR = 'data-score-row';

/**
 * 這個按鍵要往哪個方向換列。`0` = 不是換列鍵，呼叫端該原樣放行。
 *
 * `Enter` 跟 `↓` 同向 —— 試算表的心智模型裡「打完這格就往下」。
 */
export function scoreKeyStep(event: KeyboardEvent): -1 | 0 | 1 {
  if (event.key === 'ArrowUp') return -1;
  if (event.key === 'ArrowDown' || event.key === 'Enter') return 1;
  return 0;
}

/**
 * 從 `start` 往 `step` 的方向找第一個可輸入的分數欄，聚焦並選取。
 *
 * **會跳過 disabled 的格子**（缺考的學生／科目分數欄是鎖住的）——
 * 不跳過的話 `focus()` 打在 disabled 元素上是無效操作，游標卡在原地，
 * 看起來像鍵盤壞了。
 *
 * 走到頭就**留在原地不回捲** —— 回捲會讓人以為自己按錯了。
 */
export function focusScoreRow(
  host: HTMLElement,
  start: number,
  step: -1 | 1,
  total: number,
): boolean {
  for (let i = start; i >= 0 && i < total; i += step) {
    const field = host.querySelector<HTMLInputElement>(`[${SCORE_ROW_ATTR}="${i}"] input`);
    if (field && !field.disabled) {
      field.focus();
      field.select();
      return true;
    }
  }
  return false;
}
