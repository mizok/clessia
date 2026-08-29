import { describe, expect, it } from 'vitest';

import { isValidPeriodRange } from './billing-periods';

describe('isValidPeriodRange', () => {
  it('結束日在開始日之後', () => {
    expect(isValidPeriodRange('2026-02-01', '2026-08-31')).toBe(true);
  });

  // 單日期間是合法的（補課週、單次營隊）
  it('同一天也算合法', () => {
    expect(isValidPeriodRange('2026-02-01', '2026-02-01')).toBe(true);
  });

  it('結束日早於開始日就不合法', () => {
    expect(isValidPeriodRange('2026-08-31', '2026-02-01')).toBe(false);
  });

  /**
   * 這條記的是**刻意不做的檢查**：期間可以重疊。
   *
   * 過渡期間（舊制最後一期與新制第一期）重疊是真實情境，擋掉它只會讓行政去改日期硬湊。
   * 這個函式只看單一區間自己合不合理，跨列的關係不歸它管 —— 也沒有別的地方管。
   */
  it('只驗單一區間，不管跟別的期間有沒有重疊', () => {
    expect(isValidPeriodRange('2026-01-01', '2026-12-31')).toBe(true);
  });
});
