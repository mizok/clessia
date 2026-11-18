/**
 * 「這個時段被佔用」的課堂狀態（#2551）：`scheduled` 與 `completed`（已點名＝已發生，時段照樣被佔）。
 * 衝堂／排課衝突偵測一律用它，不要寫死 `.eq('status', 'scheduled')` —— #2546 之後點名過的堂是 completed，
 * 只篩 scheduled 會讓衝突偵測漏掉它們。
 *
 * **不要**拿它篩「可以被操作的堂」（改期、停課、改老師這類只對 scheduled 動作的篩選維持 scheduled）。
 */
export const OCCUPYING_SESSION_STATUSES: readonly ['scheduled', 'completed'] = [
  'scheduled',
  'completed',
];
