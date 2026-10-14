import type { ExamRow } from './exams.component';

export interface ExamChapter {
  readonly key: 'none' | 'partial';
  readonly name: string;
  readonly rows: readonly ExamRow[];
}

/**
 * 「待處理」分頁的分章（A6 exams：「還沒登」「登到一半」）。**只分這一頁已載入的列** ——
 * 列表是伺服器分頁，章頭的數字就是這頁的數字（頁面在總數超過一頁時加「這一頁」）。
 *
 * 一筆都沒登（`scoreCount === 0`，含 `0／0`）= 還沒登；其餘 = 登到一半。
 * 待處理清單本來就不含登完的，所以這裡不另外處理 `scoreCount >= expectedCount`：
 * 真的出現就會落在「登到一半」，看得見比被丟掉好。空章不回傳。
 */
export function chapterExamRows(rows: readonly ExamRow[]): ExamChapter[] {
  const none = rows.filter((row) => row.scoreCount === 0);
  const partial = rows.filter((row) => row.scoreCount > 0);
  return [
    { key: 'none' as const, name: '還沒登', rows: none },
    { key: 'partial' as const, name: '登到一半', rows: partial },
  ].filter((chapter) => chapter.rows.length > 0);
}
