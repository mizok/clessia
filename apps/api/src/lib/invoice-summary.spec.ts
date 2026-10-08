import { describe, expect, it } from 'vitest';

import { summarizeInvoices, type SummaryInvoice } from './invoice-summary';

const TODAY = '2026-10-08';

const inv = (over: Partial<SummaryInvoice> = {}): SummaryInvoice => ({
  issuedAt: '2026-09-01',
  dueDate: null,
  voided: false,
  items: [{ amount: 1000 }],
  payments: [],
  ...over,
});
const pay = (amount: number) => ({ kind: 'payment' as const, amount });
const refund = (amount: number) => ({ kind: 'refund' as const, amount });

describe('summarizeInvoices（#1314 P1／P2）', () => {
  it('各狀態張數；未繳與部分繳帶待收金額', () => {
    const s = summarizeInvoices(
      [
        inv(),
        inv({ payments: [pay(300)] }),
        inv({ payments: [pay(1000)] }),
        inv({ payments: [pay(500), refund(800)] }),
        inv({ voided: true }),
      ],
      TODAY,
    );
    expect(s.byStatus).toEqual({
      unpaid: { count: 1, outstanding: 1000 },
      partial: { count: 1, outstanding: 700 },
      paid: { count: 1 },
      overrefunded: { count: 1 },
      void: { count: 1 },
    });
  });

  it('逾期＝未繳清且過了到期日；到期日當天與沒有到期日都不算', () => {
    const s = summarizeInvoices(
      [
        inv({ dueDate: '2026-10-07' }),
        inv({ dueDate: '2026-10-07', payments: [pay(400)] }),
        inv({ dueDate: TODAY }),
        inv({ dueDate: null }),
        inv({ dueDate: '2026-10-01', payments: [pay(1000)] }),
        inv({ dueDate: '2026-10-01', voided: true }),
      ],
      TODAY,
    );
    expect(s.overdue).toEqual({ count: 2, outstanding: 1600 });
  });

  it('本月：本月開立的非作廢帳單，應收＝明細合計、已收＝至今淨收', () => {
    const s = summarizeInvoices(
      [
        inv({ issuedAt: '2026-10-01', items: [{ amount: 2000 }], payments: [pay(500)] }),
        inv({ issuedAt: '2026-10-08', items: [{ amount: 1000 }, { amount: -200 }] }),
        inv({ issuedAt: '2026-10-02', voided: true }),
        inv({ issuedAt: '2026-09-30', payments: [pay(1000)] }),
      ],
      TODAY,
    );
    expect(s.month).toEqual({ month: '2026-10', billed: 2800, received: 500 });
  });

  it('沒有帳單 → 全零', () => {
    const s = summarizeInvoices([], TODAY);
    expect(s.byStatus.unpaid).toEqual({ count: 0, outstanding: 0 });
    expect(s.overdue).toEqual({ count: 0, outstanding: 0 });
    expect(s.month).toEqual({ month: '2026-10', billed: 0, received: 0 });
  });
});
