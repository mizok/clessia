import { describe, expect, it } from 'vitest';

import {
  deriveInvoiceStatus,
  invoiceTotals,
  isOpenInvoice,
  voidBlockReason,
} from './invoice-status';

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
    expect(deriveInvoiceStatus([item(3000)], [], false)).toBe('unpaid');
  });

  /**
   * 定金就是這個狀態（規則 6）：報名時開全額帳單，定金是它的第一筆部分收款，
   * 帳單自動變「部分繳」—— 系統不需要「定金」這個概念。
   */
  it('收了一部分 → 部分繳', () => {
    expect(deriveInvoiceStatus([item(3000)], [pay(1000)], false)).toBe('partial');
  });

  it('收滿 → 繳清', () => {
    expect(deriveInvoiceStatus([item(3000)], [pay(3000)], false)).toBe('paid');
  });

  it('分次收滿也是繳清（一張帳單對多筆收款）', () => {
    expect(deriveInvoiceStatus([item(3000)], [pay(1000), pay(2000)], false)).toBe('paid');
  });

  it('多收了還是繳清，不會變成別的狀態', () => {
    expect(deriveInvoiceStatus([item(3000)], [pay(3500)], false)).toBe('paid');
  });

  // 退費把已收的錢退回去，狀態要跟著退回來 —— 不然退完款帳單還顯示繳清
  it('退費會把繳清退回部分繳', () => {
    expect(deriveInvoiceStatus([item(3000)], [pay(3000), refund(1000)], false)).toBe('partial');
  });

  it('全額退費退回未繳', () => {
    expect(deriveInvoiceStatus([item(3000)], [pay(3000), refund(3000)], false)).toBe('unpaid');
  });

  // 剛開好、還沒加明細的帳單。顯示「繳清」會騙人 —— 什麼都還沒收
  it('沒有明細也沒有收款 → 未繳，不是繳清', () => {
    expect(deriveInvoiceStatus([], [], false)).toBe('unpaid');
  });
});

// #898：作廢是**事實**（voided_at 欄位），不是從金額推出來的 —— 所以它蓋過其餘三態
describe('deriveInvoiceStatus —— 作廢', () => {
  it('作廢優先於未繳', () => {
    expect(deriveInvoiceStatus([item(3000)], [], true)).toBe('void');
  });

  // 淨額歸零才能作廢，所以「收了又全退」是作廢單最常見的樣子
  it('收了又全退、再作廢 → 作廢，不是未繳', () => {
    expect(deriveInvoiceStatus([item(3000)], [pay(3000), refund(3000)], true)).toBe('void');
  });

  // DB 擋得住淨額 ≠ 0 的作廢，但推導不該依賴那一層 —— 資料若真長這樣，仍然回作廢
  it('作廢優先於繳清與部分繳', () => {
    expect(deriveInvoiceStatus([item(3000)], [pay(3000)], true)).toBe('void');
    expect(deriveInvoiceStatus([item(3000)], [pay(1000)], true)).toBe('void');
  });

  it('空帳單作廢 → 作廢', () => {
    expect(deriveInvoiceStatus([], [], true)).toBe('void');
  });

  // 金額照算：作廢單的明細與收退款是歷史，詳情頁要看得到
  it('作廢不改變 invoiceTotals', () => {
    expect(invoiceTotals([item(3000)], [pay(3000), refund(3000)])).toEqual({ total: 3000, net: 0 });
  });
});

/**
 * 「還在等錢」的唯一定義。在 #898 之前全系統寫成 `status !== 'paid'`，
 * 多一個 void 之後那個寫法會把作廢單以全額算進催繳、逾期、家長應繳。
 */
describe('isOpenInvoice', () => {
  it('未繳與部分繳是 open', () => {
    expect(isOpenInvoice('unpaid')).toBe(true);
    expect(isOpenInvoice('partial')).toBe(true);
  });

  it('繳清與作廢不是 open', () => {
    expect(isOpenInvoice('paid')).toBe(false);
    expect(isOpenInvoice('void')).toBe(false);
  });
});

/**
 * 作廢的前置條件（使用者 2026-09-30 裁決）。API 用它回看得懂的錯誤；
 * 真正的保證在 DB trigger（淨額與不可撤銷），堂數包那條只有這一層。
 */
describe('voidBlockReason', () => {
  const ok = { voided: false, netPaid: 0, hasSessionPack: false };

  it('淨額 0、未作廢、沒有堂數包 → 可以作廢', () => {
    expect(voidBlockReason(ok)).toBeNull();
  });

  it('已作廢 → ALREADY_VOIDED（不可撤銷，也不能重複作廢）', () => {
    expect(voidBlockReason({ ...ok, voided: true })).toBe('ALREADY_VOIDED');
  });

  it('淨額 > 0 → NET_PAID_NONZERO', () => {
    expect(voidBlockReason({ ...ok, netPaid: 1000 })).toBe('NET_PAID_NONZERO');
  });

  // 裁決 A：退多了 = 還欠家長錢，作廢會讓那筆欠款從畫面消失
  it('淨額 < 0 也 → NET_PAID_NONZERO', () => {
    expect(voidBlockReason({ ...ok, netPaid: -500 })).toBe('NET_PAID_NONZERO');
  });

  // 裁決 D：作廢帳單但堂數包還在 = 學生有沒收錢的堂數
  it('有連到堂數包 → HAS_SESSION_PACK', () => {
    expect(voidBlockReason({ ...ok, hasSessionPack: true })).toBe('HAS_SESSION_PACK');
  });

  // 已作廢要先講 —— 對一張作廢單說「請先退款」是錯的指示
  it('已作廢優先於其他原因', () => {
    expect(voidBlockReason({ voided: true, netPaid: 1000, hasSessionPack: true })).toBe(
      'ALREADY_VOIDED',
    );
  });
});
