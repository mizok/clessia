import { describe, expect, it } from 'vitest';

import { prorateByDays, monthRange } from './proration';

const march = { start: '2026-03-01', end: '2026-03-31' };

describe('prorateByDays', () => {
  it('整期都在讀就是全額，不加註記', () => {
    expect(prorateByDays(4500, march, { from: '2026-01-01', to: null })).toEqual({
      amount: 4500,
      note: null,
    });
  });

  /**
   * 比例金額是**開單時的建議值**（billing-rules 規則 3），不是死規則 —— 所以 note 要把
   * 基準寫出來讓行政看得懂、改得動。只給一個數字的話沒有人知道它怎麼來的。
   */
  it('期中插班按剩餘天數收，並記下基準', () => {
    const result = prorateByDays(3100, march, { from: '2026-03-12', to: null });

    // 3/12–3/31 共 20 天，當月 31 天
    expect(result.amount).toBe(2000);
    expect(result.note).toContain('20/31');
  });

  it('期中退班按已讀天數收', () => {
    const result = prorateByDays(3100, march, { from: '2026-01-01', to: '2026-03-10' });

    // 3/1–3/10 共 10 天
    expect(result.amount).toBe(1000);
    expect(result.note).toContain('10/31');
  });

  it('插班又退班：只算中間那段', () => {
    expect(prorateByDays(3100, march, { from: '2026-03-11', to: '2026-03-20' }).amount).toBe(1000);
  });

  // 這一期完全沒讀 —— 呼叫端看到 0 就該整筆跳過，不要開一列 0 元的學費
  it('完全沒有重疊回 0', () => {
    expect(prorateByDays(4500, march, { from: '2026-04-01', to: null }).amount).toBe(0);
    expect(prorateByDays(4500, march, { from: '2026-01-01', to: '2026-02-28' }).amount).toBe(0);
  });

  it('金額取整數 —— 台幣沒有小數', () => {
    expect(
      Number.isInteger(prorateByDays(4500, march, { from: '2026-03-08', to: null }).amount),
    ).toBe(true);
  });
});

/**
 * `monthRange` 原本是 `routes/billing-runs.ts` 的私有函式、**沒有任何測試**。
 * 搬成共用（月結批次與報名試算都吃它）之後補上 —— 它算錯的話錯的是錢，
 * 而「二月有幾天」正是那種每個人都以為自己記得的東西。
 */
describe('monthRange', () => {
  it('大月', () => {
    expect(monthRange('2026-03')).toEqual({ start: '2026-03-01', end: '2026-03-31' });
  });

  it('小月', () => {
    expect(monthRange('2026-04')).toEqual({ start: '2026-04-01', end: '2026-04-30' });
  });

  it('平年的二月', () => {
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('閏年的二月', () => {
    expect(monthRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });

  it('十二月 —— 跨年不能算到下一年的第 0 天去', () => {
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });

  it('帶完整日期時取那個月，不是從那天算起', () => {
    expect(monthRange('2026-03-17')).toEqual({ start: '2026-03-01', end: '2026-03-31' });
  });
});
