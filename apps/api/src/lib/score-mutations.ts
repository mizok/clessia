/**
 * 成績批次寫入的分流（#886）。
 *
 * **「清空分數後儲存」等於刪除那一列** —— 在這之前系統裡沒有任何刪除成績的路，
 * 於是一場考試只要登錄過一筆成績，它與它的成績就再也刪不掉（三道關卡疊起來，
 * 見 `kb/wiki/architecture/score-deletion.md`）。
 *
 * 判準住在這裡而不是各自寫在兩支路由裡，是因為**它有一個會造成資料遺失的陷阱**：
 * 只看 `score === null` 的話會連缺考與補考一起刪掉。同一條規則散在兩個地方，
 * 遲早會有一邊被簡化成那個錯的版本（#655 的「同一個規則四份載體」就是這個形狀）。
 */

export type ScoreStatus = 'scored' | 'absent' | 'makeup';

export interface ScoreMutationLike {
  readonly score: number | null;
  readonly status: ScoreStatus;
}

/**
 * 這一筆是不是「使用者把分數清掉了」。
 *
 * **兩個條件必須並存。** `absent`（缺考）與 `makeup`（補考）的 `score` 本來就是 null
 * —— 前端選「缺考」時會主動把分數清掉（`academy-score-editor.component.ts:209-215`）——
 * 而那是**被登錄過的事實**，不是「沒有成績」。
 *
 * `score === null` 而不是 `!score`：**0 分是有效成績**，`!0` 會把它當成空值。
 */
export function isScoreCleared(item: ScoreMutationLike): boolean {
  return item.score === null && item.status === 'scored';
}

/** 把一批成績分成「要寫進去的」與「要刪掉的」。順序與物件本身都原樣保留。 */
export function splitScoreMutations<T extends ScoreMutationLike>(
  items: readonly T[],
): { toUpsert: T[]; toDelete: T[] } {
  const toUpsert: T[] = [];
  const toDelete: T[] = [];

  for (const item of items) {
    if (isScoreCleared(item)) {
      toDelete.push(item);
    } else {
      toUpsert.push(item);
    }
  }

  return { toUpsert, toDelete };
}
