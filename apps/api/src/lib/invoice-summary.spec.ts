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

  it('未繳清三章（#1314 P1）：互斥、聯集＝unpaid＋partial；沒到期日落 notDue', () => {
    const s = summarizeInvoices(
      [
        inv({ dueDate: '2026-10-07' }), // overdue 1000
        inv({ dueDate: TODAY, payments: [pay(400)] }), // dueSoon 600
        inv({ dueDate: '2026-10-15' }), // dueSoon（第 7 天）1000
        inv({ dueDate: '2026-10-16', payments: [pay(100)] }), // notDue（第 8 天）900
        inv({ dueDate: null }), // notDue（沒到期日）1000
        inv({ dueDate: '2026-10-09', payments: [pay(1000)] }), // 繳清：不進任何一章
        inv({ dueDate: '2026-10-09', voided: true }), // 作廢：不進
        inv({ dueDate: '2026-10-09', payments: [pay(500), refund(800)] }), // 多退：不進
      ],
      TODAY,
    );
    expect(s.overdue).toEqual({ count: 1, outstanding: 1000 });
    expect(s.dueSoon).toEqual({ count: 2, outstanding: 1600, days: 7 });
    expect(s.notDue).toEqual({ count: 2, outstanding: 1900 });
    const open = s.byStatus.unpaid.count + s.byStatus.partial.count;
    const owed = s.byStatus.unpaid.outstanding + s.byStatus.partial.outstanding;
    expect(s.overdue.count + s.dueSoon.count + s.notDue.count).toBe(open);
    expect(s.overdue.outstanding + s.dueSoon.outstanding + s.notDue.outstanding).toBe(owed);
  });

  it('outstanding（#1314 P3）＝三章 outstanding 和；作廢、繳清、多退不進', () => {
    const s = summarizeInvoices(
      [
        inv({ dueDate: '2026-10-07' }), // overdue 1000
        inv({ dueDate: '2026-10-10', payments: [pay(400)] }), // dueSoon 600
        inv({ dueDate: null, payments: [pay(100)] }), // notDue 900
        inv({ payments: [pay(1000)] }), // 繳清
        inv({ voided: true }), // 作廢
        inv({ payments: [pay(500), refund(800)] }), // 多退
      ],
      TODAY,
    );
    expect(s.outstanding).toBe(2500);
    expect(s.outstanding).toBe(
      s.overdue.outstanding + s.dueSoon.outstanding + s.notDue.outstanding,
    );
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
    expect(s.outstanding).toBe(0);
    expect(s.byStatus.unpaid).toEqual({ count: 0, outstanding: 0 });
    expect(s.overdue).toEqual({ count: 0, outstanding: 0 });
    expect(s.month).toEqual({ month: '2026-10', billed: 0, received: 0 });
  });
});
