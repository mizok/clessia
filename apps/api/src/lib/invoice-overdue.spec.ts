import { describe, expect, it } from 'vitest';

import { OVERDUE_DUE_DATE_COLUMN, isOverdueOn, whereOverdue } from './invoice-overdue';

describe('isOverdueOn', () => {
  /**
   * 規則 7 的原話是「**過了** due_date 未繳清」—— 到期日當天還沒過，不算逾期。
   * 這條邊界是這支函式存在的理由：`<` 與 `<=` 只差一個字元，而兩處各寫一份的話
   * 只有其中一處會被改到，使用者就會在繳費頁與營收報表對同一張帳單看到相反的結論。
   */
  it('到期日當天不算逾期，隔天才算', () => {
    expect(isOverdueOn('2026-03-31', '2026-03-31')).toBe(false);
    expect(isOverdueOn('2026-03-30', '2026-03-31')).toBe(true);
    expect(isOverdueOn('2026-04-01', '2026-03-31')).toBe(false);
  });

  /** 沒有到期日 = 還沒發收費袋，那還不叫欠（`billing-rules.md:63`） */
  it('沒有到期日不算逾期', () => {
    expect(isOverdueOn(null, '2026-03-31')).toBe(false);
  });
});

describe('whereOverdue', () => {
  /**
   * SQL 那一側的觀測值沒有鑑別力（假替身不管條件下對下錯都回一樣的列），
   * 所以斷言**送出去的查詢長什麼樣**：欄位、運算子、值。
   * 這條跟上面那條 `isOverdueOn` 的邊界必須是同一個判斷 —— 它們現在來自同一支檔案。
   */
  it('下的是 due_date < 今天（不是 lte）', () => {
    const calls: Array<[string, string, string]> = [];
    const query = {
      lt(column: string, value: string) {
        calls.push(['lt', column, value]);
        return this;
      },
      lte(column: string, value: string) {
        calls.push(['lte', column, value]);
        return this;
      },
    };

    const result = whereOverdue(query, '2026-03-31');

    expect(calls).toEqual([['lt', OVERDUE_DUE_DATE_COLUMN, '2026-03-31']]);
    expect(result).toBe(query);
  });
});
