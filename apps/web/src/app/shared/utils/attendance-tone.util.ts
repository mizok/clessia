import type { StatusTone } from '@shared/components/status/status-dot/status-dot.component';

import { hasSessionEnded, type SessionTimeLike } from './session-time.util';

/**
 * 「這堂課的點名狀態該是什麼顏色」—— 跨頁共用的單一定義。
 *
 * **為什麼共用**：課堂管理與儀表板問的是同一個問題。`hasSessionEnded` 已經統一了
 * 「上完了沒」，但如果 tone 的對映各寫一份，同樣的分裂會在顏色上重演一次 ——
 * 兩個畫面對同一堂課說不一樣的話。
 *
 * 四態的理由：
 * - **停課** → `inactive`：不在等任何事了，不該催
 * - **已點名** → `done`：做完就是做完
 * - **還沒上完** → `pending`（無色相）：正常的未完成，不該叫任何人焦慮。
 *   這一態是常態，所以它必須沒有顏色 —— 否則整欄都是警示，警示就失去意義
 * - **上完了還沒點** → `overdue`：該完成的時候過了還沒完成
 */
export function attendanceTone(
  input: { time: SessionTimeLike; cancelled: boolean; taken: boolean },
  now: Date,
): StatusTone {
  if (input.cancelled) return 'inactive';
  if (input.taken) return 'done';
  if (!hasSessionEnded(input.time, now)) return 'pending';
  return 'overdue';
}
