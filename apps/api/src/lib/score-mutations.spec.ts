import { describe, expect, it } from 'vitest';

import { isScoreCleared, splitScoreMutations } from './score-mutations';

/**
 * **#886：清空分數後儲存 ＝ 刪除那一列。**
 *
 * 判準必須是 `score === null && status === 'scored'` **兩個條件並存**。
 * 只看 `score === null` 的話會把**缺考與補考一起刪掉** —— 那兩種的 `score` 本來就是 null，
 * 而它們是「被登錄過的事實」，不是「沒有成績」。
 *
 * 這個判準不是新發明的：前端兩處現在就是用它來把那些列**排除掉不送出**
 * （`academy-score-editor.component.ts:243-245`、`score-edit-dialog.component.ts:302-303`）。
 * 這一支改的是**處置**，不是判準。
 *
 * ⚠️ 探索時一度被回報成「`makeup` 沒有寫入點、UI 沒有補考入口」——**那是錯的**
 * （`academy-score-editor.component.ts:52` 就是那顆「補考」）。照那份回報寫，
 * 判準會被簡化成「`score === null` 就刪」，而那會無聲刪掉所有缺考與補考紀錄。
 * 底下第二、三條測試就是釘住這件事的。
 */
describe('isScoreCleared', () => {
  it('score 是 null 且 status 是 scored —— 這是「清空」', () => {
    expect(isScoreCleared({ score: null, status: 'scored' })).toBe(true);
  });

  it('缺考的 null 不是清空', () => {
    expect(isScoreCleared({ score: null, status: 'absent' })).toBe(false);
  });

  it('補考的 null 不是清空', () => {
    expect(isScoreCleared({ score: null, status: 'makeup' })).toBe(false);
  });

  it('有分數就不是清空 —— 連 0 分都算有分數', () => {
    expect(isScoreCleared({ score: 0, status: 'scored' })).toBe(false);
    expect(isScoreCleared({ score: 58, status: 'scored' })).toBe(false);
  });

  // 0 分那一條單獨再釘一次：`!score` 這種寫法會把 0 當成空值，
  // 而「考 0 分」與「沒有成績」在這個系統裡是兩件事。
  it('0 分不是 falsy 陷阱', () => {
    expect(isScoreCleared({ score: 0, status: 'absent' })).toBe(false);
  });
});

describe('splitScoreMutations', () => {
  const rows = [
    { studentId: 's1', score: 88, status: 'scored' as const },
    { studentId: 's2', score: null, status: 'scored' as const }, // 清空 → 刪
    { studentId: 's3', score: null, status: 'absent' as const }, // 缺考 → 留
    { studentId: 's4', score: null, status: 'makeup' as const }, // 補考 → 留
    { studentId: 's5', score: 0, status: 'scored' as const },
  ];

  it('只有清空的那一列進 toDelete，其餘全部進 toUpsert', () => {
    const { toUpsert, toDelete } = splitScoreMutations(rows);

    expect(toDelete.map((r) => r.studentId)).toEqual(['s2']);
    expect(toUpsert.map((r) => r.studentId)).toEqual(['s1', 's3', 's4', 's5']);
  });

  it('保留原本的順序與物件本身（不複製、不重排）', () => {
    const { toUpsert } = splitScoreMutations(rows);

    expect(toUpsert[0]).toBe(rows[0]);
  });

  it('全部清空時 toUpsert 是空的', () => {
    const { toUpsert, toDelete } = splitScoreMutations([
      { studentId: 's1', score: null, status: 'scored' as const },
    ]);

    expect(toUpsert).toEqual([]);
    expect(toDelete).toHaveLength(1);
  });

  it('沒有任何清空時 toDelete 是空的 —— 現況的行為不變', () => {
    const { toUpsert, toDelete } = splitScoreMutations([
      { studentId: 's1', score: 90, status: 'scored' as const },
      { studentId: 's2', score: null, status: 'absent' as const },
    ]);

    expect(toDelete).toEqual([]);
    expect(toUpsert).toHaveLength(2);
  });

  it('空陣列兩邊都是空的', () => {
    expect(splitScoreMutations([])).toEqual({ toUpsert: [], toDelete: [] });
  });
});
