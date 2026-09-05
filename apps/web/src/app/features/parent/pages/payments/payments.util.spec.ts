import type { ParentInvoice } from '@core/parent-billing.service';
import { groupInvoices, latestPaymentDate } from './payments.util';

const invoice = (overrides: Partial<ParentInvoice> = {}): ParentInvoice => ({
  id: 'inv-1',
  issuedAt: '2026-08-01',
  dueDate: '2026-08-15',
  status: 'unpaid',
  total: 5000,
  netPaid: 0,
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

    it('沒有已取消這一組——全系統的狀態值域只有三態', () => {
      const groups = groupInvoices([invoice({ status: 'paid' })]);
      expect(Object.keys(groups)).toEqual(['pending', 'paid']);
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
