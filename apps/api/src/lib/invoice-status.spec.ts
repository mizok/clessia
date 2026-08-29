import { describe, expect, it } from 'vitest';

import { deriveInvoiceStatus, invoiceTotals } from './invoice-status';

const item = (amount: number) => ({ amount });
const pay = (amount: number) => ({ kind: 'payment' as const, amount });
const refund = (amount: number) => ({ kind: 'refund' as const, amount });

describe('invoiceTotals', () => {
  it('應收是明細加總，實收是收款減退費', () => {
    expect(invoiceTotals([item(3000), item(500)], [pay(1000), refund(200)])).toEqual({
      total: 3500,
      net: 800,
    });
  });

  // 調整列可以是負數（規則 2 的人工覆寫），加總要照實算
  it('負數的調整列會把應收拉低', () => {
    expect(invoiceTotals([item(3000), item(-500)], []).total).toBe(2500);
  });
});

describe('deriveInvoiceStatus', () => {
  it('一毛未收 → 未繳', () => {
    expect(deriveInvoiceStatus([item(3000)], [])).toBe('unpaid');
  });

  /**
   * 定金就是這個狀態（規則 6）：報名時開全額帳單，定金是它的第一筆部分收款，
   * 帳單自動變「部分繳」—— 系統不需要「定金」這個概念。
   */
  it('收了一部分 → 部分繳', () => {
    expect(deriveInvoiceStatus([item(3000)], [pay(1000)])).toBe('partial');
  });

  it('收滿 → 繳清', () => {
    expect(deriveInvoiceStatus([item(3000)], [pay(3000)])).toBe('paid');
  });

  it('分次收滿也是繳清（一張帳單對多筆收款）', () => {
    expect(deriveInvoiceStatus([item(3000)], [pay(1000), pay(2000)])).toBe('paid');
  });

  it('多收了還是繳清，不會變成別的狀態', () => {
    expect(deriveInvoiceStatus([item(3000)], [pay(3500)])).toBe('paid');
  });

  // 退費把已收的錢退回去，狀態要跟著退回來 —— 不然退完款帳單還顯示繳清
  it('退費會把繳清退回部分繳', () => {
    expect(deriveInvoiceStatus([item(3000)], [pay(3000), refund(1000)])).toBe('partial');
  });

  it('全額退費退回未繳', () => {
    expect(deriveInvoiceStatus([item(3000)], [pay(3000), refund(3000)])).toBe('unpaid');
  });

  // 剛開好、還沒加明細的帳單。顯示「繳清」會騙人 —— 什麼都還沒收
  it('沒有明細也沒有收款 → 未繳，不是繳清', () => {
    expect(deriveInvoiceStatus([], [])).toBe('unpaid');
  });
});
