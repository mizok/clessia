import type { ParentInvoice } from '@core/parent-billing.service';
import { dueTag, groupInvoices, invoiceTitle, latestPaymentDate } from './payments.util';

const invoice = (overrides: Partial<ParentInvoice> = {}): ParentInvoice => ({
  id: 'inv-1',
  invoiceNo: null,
  issuedAt: '2026-08-01',
  dueDate: '2026-08-15',
  status: 'unpaid',
  total: 5000,
  netPaid: 0,
  voidedAt: null,
  items: [],
  payments: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

describe('payments.util', () => {
  describe('groupInvoices', () => {
    it('unpaid 與 partial 都進待付款組', () => {
      const groups = groupInvoices([
        invoice({ id: 'a', status: 'unpaid' }),
        invoice({ id: 'b', status: 'partial' }),
        invoice({ id: 'c', status: 'paid' }),
      ]);

      expect(groups.pending.map((i) => i.id)).toEqual(['a', 'b']);
      expect(groups.paid.map((i) => i.id)).toEqual(['c']);
    });

    // #898 裁決 E：家長看得到作廢單（收合），但它不是「待付款」也不是「已付款」
    it('作廢單自成一組，不進待付款也不進已付款', () => {
      const groups = groupInvoices([
        invoice({ id: 'a', status: 'unpaid' }),
        invoice({ id: 'v', status: 'void', voidedAt: '2026-08-20T00:00:00Z' }),
        invoice({ id: 'c', status: 'paid' }),
      ]);

      expect(groups.pending.map((i) => i.id)).toEqual(['a']);
      expect(groups.paid.map((i) => i.id)).toEqual(['c']);
      expect(groups.voided.map((i) => i.id)).toEqual(['v']);
    });
  });

  describe('latestPaymentDate', () => {
    it('沒有付款記錄回 null', () => {
      expect(latestPaymentDate(invoice({ payments: [] }))).toBeNull();
    });

    it('取最晚的一筆付款日期', () => {
      const result = latestPaymentDate(
        invoice({
          payments: [
            {
              id: 'p1',
              kind: 'payment',
              amount: 3000,
              method: 'cash',
              paidAt: '2026-08-05',
              receiptNo: 1,
            },
            {
              id: 'p2',
              kind: 'payment',
              amount: 2000,
              method: 'transfer',
              paidAt: '2026-08-10',
              receiptNo: 2,
            },
          ],
        }),
      );

      expect(result).toBe('2026-08-10');
    });
  });
});

// #1034：多退的帳單以前落進「待付款」，叫家長再繳一次
describe('groupInvoices —— 多退', () => {
  it('多退不是待付款，歸在已付款那組', () => {
    const groups = groupInvoices([invoice({ id: 'a', status: 'overrefunded', netPaid: -500 })]);

    expect(groups.pending).toEqual([]);
    expect(groups.paid.map((i) => i.id)).toEqual(['a']);
  });

  describe('invoiceTitle', () => {
    it('班名去重；沒有班名退回項目種類', () => {
      const item = (type: 'tuition' | 'meal', className: string | null) => ({
        id: Math.random().toString(),
        type,
        amount: 1,
        periodMonth: null,
        className,
      });
      expect(
        invoiceTitle(
          invoice({
            items: [item('tuition', '數學'), item('tuition', '數學'), item('meal', null)],
          }),
        ),
      ).toBe('數學、餐費');
    });
  });

  describe('dueTag', () => {
    const tag = (dueDate: string | null, status: 'unpaid' | 'partial' = 'unpaid') =>
      dueTag(invoice({ dueDate, status }), '2026-10-10');

    it('逾期／今天／7 天內／更晚', () => {
      expect(tag('2026-10-08')).toEqual({ tone: 'overdue', label: '逾期 2 天' });
      expect(tag('2026-10-10')).toEqual({ tone: 'pending', label: '今天到期' });
      expect(tag('2026-10-17')).toEqual({ tone: 'pending', label: '7 天後到期' });
      expect(tag('2026-10-18')).toEqual({ tone: 'inactive', label: '未到期' });
    });

    it('部分繳加前綴；沒有期限日 → null', () => {
      expect(tag('2026-10-12', 'partial')?.label).toBe('部分繳 · 2 天後到期');
      expect(tag(null)).toBeNull();
    });
  });
});
