import { describe, expect, it } from 'vitest';

import { sliceDerivedPage } from './derived-page';

const rows = Array.from({ length: 25 }, (_, i) => i + 1);

describe('sliceDerivedPage', () => {
  /**
   * 這條守的正是**這次漏掉的形狀**：`total` 必須是**篩後全體**的筆數，不是這一頁的。
   * 原本的寫法在切頁之後才 `rows.length`，於是除了最後一頁以外 total 永遠等於
   * pageSize —— 前端算出來的頁數永遠是 1 或 2。
   */
  it('第二頁的 total 仍然是全體筆數，不是當頁筆數', () => {
    const result = sliceDerivedPage(rows, 2, 10);

    expect(result.rows).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(result.total).toBe(25);
  });

  it('第一頁也一樣', () => {
    expect(sliceDerivedPage(rows, 1, 10).total).toBe(25);
  });

  it('最後一頁不足一頁，total 不受影響', () => {
    const result = sliceDerivedPage(rows, 3, 10);

    expect(result.rows).toHaveLength(5);
    expect(result.total).toBe(25);
  });

  it('超出範圍的頁碼回空陣列，total 照舊', () => {
    const result = sliceDerivedPage(rows, 9, 10);

    expect(result.rows).toEqual([]);
    expect(result.total).toBe(25);
  });

  it('空集合', () => {
    expect(sliceDerivedPage([], 1, 10)).toEqual({ rows: [], total: 0 });
  });
});
