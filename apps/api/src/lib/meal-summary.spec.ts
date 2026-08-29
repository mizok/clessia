import { describe, expect, it } from 'vitest';

import { summariseMealRecords } from './meal-summary';

const row = (over: Partial<Parameters<typeof summariseMealRecords>[0][number]> = {}) => ({
  ordered: true,
  chargeable: true,
  unitPrice: 65,
  settled: false,
  ...over,
});

describe('summariseMealRecords', () => {
  /**
   * spec 明說「總數取後端的 `meta.total`，不要抓單頁明細自己加 —— 列表 API pageSize
   * 上限 100，量大的月份會悄悄少算而且**錯得沒有徵兆**」。這支就是那個後端加總，
   * 所以它吃的是**整個區間**的列，不是當頁的。
   */
  it('加總要收費的餐記錄', () => {
    expect(summariseMealRecords([row(), row(), row({ unitPrice: 70 })])).toEqual({
      total: 3,
      chargeableCount: 3,
      totalAmount: 200,
      settledCount: 0,
    });
  });

  // 沒訂餐的那天不算錢，但它仍然是一筆記錄（「那天到底是沒訂還是沒人處理」要分得出來）
  it('沒訂的不算金額，但算筆數', () => {
    const summary = summariseMealRecords([row(), row({ ordered: false })]);

    expect(summary.total).toBe(2);
    expect(summary.chargeableCount).toBe(1);
    expect(summary.totalAmount).toBe(65);
  });

  // 「收不收費」是行政可翻的人工開關（規則 3）—— 翻掉的那筆不進金額
  it('訂了但不收費的不算金額', () => {
    const summary = summariseMealRecords([row(), row({ chargeable: false })]);

    expect(summary.chargeableCount).toBe(1);
    expect(summary.totalAmount).toBe(65);
  });

  // 已結算的照樣算進區間總額 —— 區間金額問的是「這段期間吃了多少錢」，
  // 不是「還有多少沒收」。已結幾筆另外給，因為那幾筆的開關是鎖住的
  it('已結算的算進總額，另外回報筆數', () => {
    const summary = summariseMealRecords([row({ settled: true }), row()]);

    expect(summary.totalAmount).toBe(130);
    expect(summary.settledCount).toBe(1);
  });

  it('空區間', () => {
    expect(summariseMealRecords([])).toEqual({
      total: 0,
      chargeableCount: 0,
      totalAmount: 0,
      settledCount: 0,
    });
  });
});
