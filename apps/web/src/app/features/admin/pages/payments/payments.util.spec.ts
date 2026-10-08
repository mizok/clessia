import {
  daysOverdue,
  daysUntilDue,
  isOverdue,
  outstanding,
  overRefunded,
  receiptNoOf,
} from './payments.util';
import type { Invoice, PaymentRecord } from '@core/invoices.service';

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'i1',
    orgId: 'o1',
    studentId: 's1',
    studentName: '陳小明',
    issuedAt: '2026-08-01',
    dueDate: '2026-08-15',
    note: null,
    status: 'unpaid',
    total: 3000,
    netPaid: 0,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    items: [],
    payments: [],
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 'p1',
    kind: 'payment',
    amount: 1000,
    method: 'cash',
    paidAt: '2026-08-10',
    proofPath: null,
    receiptNo: 12,
    note: null,
    recordedBy: 'u1',
    ...overrides,
  };
}

const TODAY = '2026-08-29';

describe('isOverdue', () => {
  it('過了到期日又沒繳清就是逾期', () => {
    expect(isOverdue(invoice(), TODAY)).toBe(true);
  });

  // 逾期是「未繳清」的衍生標記 —— 繳清的帳單再久也不是欠繳（billing-rules 規則 4）
  it('繳清的帳單不算逾期，即使早就過期', () => {
    expect(isOverdue(invoice({ status: 'paid', netPaid: 3000 }), TODAY)).toBe(false);
  });

  it('部分繳但過期，算逾期', () => {
    expect(isOverdue(invoice({ status: 'partial', netPaid: 1000 }), TODAY)).toBe(true);
  });

  // 沒有到期日就沒有「過了」可言。用 Date 解析 null 會得到 1970，那會讓整批舊帳單誤報逾期
  it('沒有到期日就不會逾期', () => {
    expect(isOverdue(invoice({ dueDate: null }), TODAY)).toBe(false);
  });

  // spec 寫的是「過了 due_date」—— 當天還在期限內
  it('到期日當天不算逾期', () => {
    expect(isOverdue(invoice({ dueDate: TODAY }), TODAY)).toBe(false);
  });

  it('到期日還沒到不算逾期', () => {
    expect(isOverdue(invoice({ dueDate: '2026-09-30' }), TODAY)).toBe(false);
  });

  // 字串比較才不會被時區推走一天；'2026-09-02' > '2026-08-29' 在字典序上也成立
  it('跨月比較用日期字串，不會被時區推掉一天', () => {
    expect(isOverdue(invoice({ dueDate: '2026-09-02' }), '2026-09-01')).toBe(false);
    expect(isOverdue(invoice({ dueDate: '2026-08-31' }), '2026-09-01')).toBe(true);
  });
});

describe('outstanding', () => {
  it('未繳時等於應繳總額', () => {
    expect(outstanding(invoice())).toBe(3000);
  });

  it('部分繳時是差額', () => {
    expect(outstanding(invoice({ netPaid: 1200 }))).toBe(1800);
  });

  it('繳清時是零', () => {
    expect(outstanding(invoice({ netPaid: 3000 }))).toBe(0);
  });

  // 退費多於應繳（例如整筆退掉又有調整）—— 夾成 0 會讓「要退多少」看不見
  it('溢繳回負數，不夾成零', () => {
    expect(outstanding(invoice({ netPaid: 3500 }))).toBe(-500);
  });
});

/**
 * #898：作廢單不逾期、不欠 —— 它的 total − netPaid 是全額，
 * 讓它逾期或欠錢就是叫行政去催一張不存在的帳單。
 */
describe('作廢單', () => {
  const voided = invoice({
    status: 'void',
    dueDate: '2026-08-01',
    voidedAt: '2026-08-20T00:00:00Z',
  });

  it('過了到期日也不算逾期', () => {
    expect(isOverdue(voided, TODAY)).toBe(false);
  });

  it('不欠任何錢', () => {
    expect(outstanding(voided)).toBe(0);
  });
});

describe('receiptNoOf', () => {
  it('沒有收款記錄就沒有收據號', () => {
    expect(receiptNoOf(invoice())).toBeNull();
  });

  // 收據印的是最近一次收款的號碼
  it('取最近一次收款的收據號', () => {
    const inv = invoice({
      payments: [
        payment({ id: 'p1', paidAt: '2026-08-10', receiptNo: 12 }),
        payment({ id: 'p2', paidAt: '2026-08-20', receiptNo: 31 }),
      ],
    });

    expect(receiptNoOf(inv)).toBe(31);
  });

  // 退費不開收據 —— 拿它的號碼去印會印出一張不存在的收款憑證
  it('退費不算收據，只有退費時回 null', () => {
    const inv = invoice({
      payments: [payment({ kind: 'refund', receiptNo: null })],
    });

    expect(receiptNoOf(inv)).toBeNull();
  });

  it('最近一筆是退費時，取更早的那筆收款', () => {
    const inv = invoice({
      payments: [
        payment({ id: 'p1', paidAt: '2026-08-10', receiptNo: 12 }),
        payment({ id: 'p2', paidAt: '2026-08-20', kind: 'refund', receiptNo: null }),
      ],
    });

    expect(receiptNoOf(inv)).toBe(12);
  });
});

// #1034：收 1,000、退 1,500（淨額 −500）以前被報成「尚欠 1,500」
describe('outstanding／overRefunded —— 多退（淨額 < 0）', () => {
  const overrefunded = invoice({ total: 1000, netPaid: -500, status: 'overrefunded' });

  it('多退不算欠', () => {
    expect(outstanding(overrefunded)).toBe(0);
  });

  it('多退顯示退多了多少', () => {
    expect(overRefunded(overrefunded)).toBe(500);
  });

  it('不是多退的帳單 overRefunded 是 0（溢繳照舊由 outstanding 的負數表達）', () => {
    expect(overRefunded(invoice({ total: 1000, netPaid: 1200, status: 'paid' }))).toBe(0);
    expect(outstanding(invoice({ total: 1000, netPaid: 1200, status: 'paid' }))).toBe(-200);
  });
});

describe('daysUntilDue／daysOverdue —— 純日期字串，不走本地時區', () => {
  it('今天到期是 0 天；逾期的帳單回 0（不是負數）', () => {
    expect(daysUntilDue(invoice({ dueDate: '2026-10-08' }), '2026-10-08')).toBe(0);
    expect(daysUntilDue(invoice({ dueDate: '2026-10-07' }), '2026-10-08')).toBe(0);
  });

  it('跨月、跨年照日曆算', () => {
    expect(daysUntilDue(invoice({ dueDate: '2026-11-02' }), '2026-10-30')).toBe(3);
    expect(daysUntilDue(invoice({ dueDate: '2027-01-02' }), '2026-12-30')).toBe(3);
    expect(daysOverdue(invoice({ dueDate: '2026-09-28' }), '2026-10-02')).toBe(4);
  });

  it('沒有到期日回 0；到期日當天不算逾期', () => {
    expect(daysUntilDue(invoice({ dueDate: null }), '2026-10-08')).toBe(0);
    expect(daysOverdue(invoice({ dueDate: null }), '2026-10-08')).toBe(0);
    expect(daysOverdue(invoice({ dueDate: '2026-10-08' }), '2026-10-08')).toBe(0);
  });
});
