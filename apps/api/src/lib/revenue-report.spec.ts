import { describe, expect, it } from 'vitest';

import { aggregateRevenue } from './revenue-report';

const TODAY = '2026-03-31';

const payment = (amount: number, groupKey = 'A') => ({
  kind: 'payment' as const,
  amount,
  groupKey,
});
const refund = (amount: number, groupKey = 'A') => ({ kind: 'refund' as const, amount, groupKey });
const invoice = (billed: number, paid: number, dueDate: string | null, groupKey = 'A') => ({
  billed,
  paid,
  dueDate,
  groupKey,
});

describe('aggregateRevenue', () => {
  /**
   * **退款單獨列，不淨額混算**（spec 的數字定義）。淨額的話「這個月收了 10 萬、退了
   * 3 萬」會顯示成「收了 7 萬」—— 那是兩個不同的經營訊號被壓成一個。
   */
  it('退款不混進實收', () => {
    const result = aggregateRevenue({
      payments: [payment(100000), refund(30000)],
      invoices: [],
      today: TODAY,
    });

    expect(result.summary.received).toBe(100000);
    expect(result.summary.refunded).toBe(30000);
  });

  it('應收未收 = 開出的應繳 − 已收', () => {
    const result = aggregateRevenue({
      payments: [],
      invoices: [invoice(10000, 4000, '2026-04-30')],
      today: TODAY,
    });

    expect(result.summary.billed).toBe(10000);
    expect(result.summary.outstanding).toBe(6000);
  });

  // 過了 due_date 還沒繳清的另外標出來（billing-rules 規則 7 的可見性需求）
  it('逾期未繳的另外算，還沒到期的不算逾期', () => {
    const result = aggregateRevenue({
      payments: [],
      invoices: [
        invoice(10000, 0, '2026-03-01'), // 已逾期
        invoice(5000, 0, '2026-04-30'), // 還沒到期
      ],
      today: TODAY,
    });

    expect(result.summary.outstanding).toBe(15000);
    expect(result.summary.overdueOutstanding).toBe(10000);
  });

  // 繳清的帳單不管到不到期都不算欠款
  it('繳清的不算未收，也不算逾期', () => {
    const result = aggregateRevenue({
      payments: [],
      invoices: [invoice(10000, 10000, '2026-01-01')],
      today: TODAY,
    });

    expect(result.summary.outstanding).toBe(0);
    expect(result.summary.overdueOutstanding).toBe(0);
  });

  // 多收的帳單不能讓未收變成負數去抵銷別張的欠款
  it('溢繳不會產生負的未收去抵銷別張', () => {
    const result = aggregateRevenue({
      payments: [],
      invoices: [invoice(1000, 1500, '2026-01-01'), invoice(2000, 0, '2026-01-01')],
      today: TODAY,
    });

    expect(result.summary.outstanding).toBe(2000);
  });

  // 沒有 due_date（還沒發收費袋）就還不算欠 —— 「欠」的定義是過了 due_date（規則 7）
  it('沒有到期日的帳單算未收但不算逾期', () => {
    const result = aggregateRevenue({
      payments: [],
      invoices: [invoice(3000, 0, null)],
      today: TODAY,
    });

    expect(result.summary.outstanding).toBe(3000);
    expect(result.summary.overdueOutstanding).toBe(0);
  });

  it('依 groupKey 分組，每組的數字各自成立', () => {
    const result = aggregateRevenue({
      payments: [payment(5000, '信義'), payment(3000, '板橋'), refund(1000, '信義')],
      invoices: [invoice(8000, 5000, '2026-03-01', '信義')],
      today: TODAY,
    });

    const xinyi = result.groups.find((g) => g.key === '信義');
    const banqiao = result.groups.find((g) => g.key === '板橋');

    expect(xinyi).toMatchObject({ received: 5000, refunded: 1000, outstanding: 3000 });
    expect(banqiao).toMatchObject({ received: 3000, refunded: 0, outstanding: 0 });
  });

  it('分組依 key 排序，順序穩定', () => {
    const result = aggregateRevenue({
      payments: [payment(1, 'B'), payment(1, 'A')],
      invoices: [],
      today: TODAY,
    });

    expect(result.groups.map((g) => g.key)).toEqual(['A', 'B']);
  });

  /**
   * **空區間回零，不是缺欄位。** 前端拿 `undefined` 去做 `toLocaleString()` 會炸，
   * 而拿它去加總會變 `NaN` —— 兩種都比「顯示 0」難查。
   */
  it('空區間每個欄位都是 0，而且欄位都在', () => {
    const result = aggregateRevenue({ payments: [], invoices: [], today: TODAY });

    expect(result.summary).toEqual({
      received: 0,
      refunded: 0,
      billed: 0,
      outstanding: 0,
      overdueOutstanding: 0,
    });
    expect(result.groups).toEqual([]);
  });
});
