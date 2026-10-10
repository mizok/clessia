import {
  canCollect,
  canReceipt,
  canRemind,
  remindedText,
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
    studentGrade: null,
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

describe('remindedText —— 列上「還沒提醒／N 天前提醒」', () => {
  it('從沒催過：還沒提醒', () => {
    expect(remindedText(invoice(), TODAY)).toBe('還沒提醒');
    expect(remindedText(invoice({ lastRemindedAt: null }), TODAY)).toBe('還沒提醒');
  });

  it('今天催的：今天提醒；三天前催的：3 天前提醒', () => {
    expect(remindedText(invoice({ lastRemindedAt: '2026-08-29T03:00:00Z' }), TODAY)).toBe(
      '今天提醒',
    );
    expect(remindedText(invoice({ lastRemindedAt: '2026-08-26T03:00:00Z' }), TODAY)).toBe(
      '3 天前提醒',
    );
  });

  // 台北 08-29 06:00 ＝ UTC 08-28 22:00：切 UTC 字串會算成「前一天」，今天催的變成 1 天前
  it('UTC 前一天晚上＝台北今天凌晨：算今天，不是 1 天前', () => {
    expect(remindedText(invoice({ lastRemindedAt: '2026-08-28T22:00:00Z' }), TODAY)).toBe(
      '今天提醒',
    );
  });

  it('不是催繳對象（繳清、作廢、多退）回 null', () => {
    expect(remindedText(invoice({ status: 'paid', netPaid: 3000 }), TODAY)).toBeNull();
    expect(remindedText(invoice({ status: 'void' }), TODAY)).toBeNull();
    expect(remindedText(invoice({ status: 'overrefunded', netPaid: -100 }), TODAY)).toBeNull();
  });

  it('部分繳還是要催', () => {
    expect(remindedText(invoice({ status: 'partial', netPaid: 1000 }), TODAY)).toBe('還沒提醒');
  });
});

describe('canRemind／canCollect／canReceipt —— 列上三顆鈕各自顯示的條件', () => {
  it('未繳清與部分繳：可提醒、可收款；沒有收款所以沒有收據', () => {
    for (const inv of [invoice(), invoice({ status: 'partial', netPaid: 1000 })]) {
      expect(canRemind(inv)).toBe(true);
      expect(canCollect(inv)).toBe(true);
    }
    expect(canReceipt(invoice())).toBe(false);
  });

  it('繳清：不提醒、不收款、有收據（有收款記錄）', () => {
    const paid = invoice({ status: 'paid', netPaid: 3000, payments: [payment()] });
    expect(canRemind(paid)).toBe(false);
    expect(canCollect(paid)).toBe(false);
    expect(canReceipt(paid)).toBe(true);
  });

  it('作廢：三顆都沒有（作廢單不欠、不催，也不該再印收據）', () => {
    const voided = invoice({ status: 'void', payments: [payment()] });
    expect(canRemind(voided)).toBe(false);
    expect(canCollect(voided)).toBe(false);
    expect(canReceipt(voided)).toBe(false);
  });

  it('多退：不提醒、不收款（不欠）；有收款記錄所以還印得出收據', () => {
    const over = invoice({ status: 'overrefunded', netPaid: -100, payments: [payment()] });
    expect(canRemind(over)).toBe(false);
    expect(canCollect(over)).toBe(false);
    expect(canReceipt(over)).toBe(true);
  });

  it('部分繳：收款可（還欠），收據也可（已有一筆）', () => {
    const part = invoice({ status: 'partial', netPaid: 1000, payments: [payment()] });
    expect(canCollect(part)).toBe(true);
    expect(canReceipt(part)).toBe(true);
  });
});
