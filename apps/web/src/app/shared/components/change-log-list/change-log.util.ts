import type { ChangeLogEntry, ScheduleChangeType } from '@core/sessions.service';

/**
 * `schedule_change_type` 的中文標籤。**這份表的完整性沒有任何東西在守** ——
 * enum 加了新值而這裡沒跟上時，表格會靠 `?? value` 顯示原始英文字（`makeup`），
 * 而**它不會拋錯、不會紅燈，列還是會出現**。
 *
 * `creation` 不是 enum 值，是後端合成的「建立課堂」那筆。
 */
export const CHANGE_TYPE_LABELS: Record<ScheduleChangeType, string> = {
  reschedule: '調課',
  substitute: '代課',
  cancellation: '停課',
  uncancel: '恢復上課',
  time_change: '改時間',
  makeup: '補課',
  creation: '建立課堂',
};

/** 類型小標的圖示（A6 沿用課表「全部異動」的那一組） */
export const CHANGE_TYPE_ICONS: Record<ScheduleChangeType, string> = {
  reschedule: 'pi-arrow-right',
  substitute: 'pi-arrow-right-arrow-left',
  cancellation: 'pi-times',
  uncancel: 'pi-replay',
  time_change: 'pi-clock',
  makeup: 'pi-link',
  creation: 'pi-plus',
};

/** 一則：單筆異動，或同一次批次操作產生的多筆 */
export interface ChangeItem {
  key: string;
  rows: ChangeLogEntry[];
}

/** 一章：同一個上課日 */
export interface ChangeChapter {
  date: string;
  items: ChangeItem[];
  count: number;
}

/**
 * 舊資料（#1195 之前）沒有批次 id：同一次批次操作寫入的列，類型、原因、操作者、建立時間
 * （到秒）都相同，用它們當分組鍵。**只在有 `batchId` 取不到時才用**。
 */
export function batchKey(e: ChangeLogEntry): string {
  return [e.changeType, e.reason, e.createdByName, e.createdAt.slice(0, 19)].join('|');
}

/**
 * 依上課日分章（A6）：今天以後的在前、由近到遠；過去的在後、由近到遠。
 * 章內同一次批次收成一則。
 *
 * 分組鍵：有 `batchId` 就用它 —— 跨分頁、同秒內兩次不同批次都不會誤併；沒有（單堂、或 #1195
 * 之前的舊批次）才退回：批次列用合成鍵，單堂用自己的 id（非批次的列即使四樣都一樣也不併）。
 */
export function groupChanges(entries: readonly ChangeLogEntry[], today: string): ChangeChapter[] {
  const dateOf = (e: ChangeLogEntry) => e.sessionDate ?? '';
  const sorted = [...entries].sort((a, b) => {
    const fa = dateOf(a) >= today;
    const fb = dateOf(b) >= today;
    if (fa !== fb) return fa ? -1 : 1;
    return fa ? dateOf(a).localeCompare(dateOf(b)) : dateOf(b).localeCompare(dateOf(a));
  });
  const chapters = new Map<string, ChangeChapter>();
  for (const e of sorted) {
    const date = dateOf(e);
    let chapter = chapters.get(date);
    if (!chapter) chapters.set(date, (chapter = { date, items: [], count: 0 }));
    chapter.count++;
    const key = e.batchId ?? (e.isBatch ? batchKey(e) : e.id);
    const item = chapter.items.find((i) => i.key === key);
    if (item) item.rows.push(e);
    else chapter.items.push({ key, rows: [e] });
  }
  return [...chapters.values()];
}
