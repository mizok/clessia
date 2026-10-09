import { DUE_SOON_DAYS, dueStateOn } from './invoice-overdue';
import {
  deriveInvoiceStatus,
  invoiceTotals,
  isOpenInvoice,
  type AmountRow,
  type PaymentRow,
} from './invoice-status';

/**
 * 帳本頁的彙總（#1314 P1／P2）：各狀態張數與待收、逾期、本月應收／已收。
 *
 * **只做加總，判準全部借既有的** —— 狀態（`deriveInvoiceStatus`）、「還在等錢」
 * （`isOpenInvoice`）、逾期（`isOverdueOn`）各只有一份定義；這裡自己判一次就是
 * 帳本頁跟繳費列表對同一張帳單說出不同結論的開始。
 *
 * 待收 = 應繳 − 淨收，只算 `isOpenInvoice` 那兩態（淨收 ≥ 0 且 < 應繳），所以不會是負數。
 */

export interface SummaryInvoice {
  readonly issuedAt: string;
  readonly dueDate: string | null;
  readonly voided: boolean;
  readonly items: AmountRow[];
  readonly payments: PaymentRow[];
}

interface Bucket {
  count: number;
  outstanding: number;
}

export interface InvoiceSummary {
  byStatus: {
    unpaid: Bucket;
    partial: Bucket;
    paid: { count: number };
    overrefunded: { count: number };
    void: { count: number };
  };
  /**
   * 未繳清的三章（#1314 P1），互斥、聯集＝ unpaid＋partial（`dueStateOn`）。
   * `overdue` 語意不變；沒有到期日的落 `notDue`
   */
  overdue: Bucket;
  dueSoon: Bucket & { days: number };
  notDue: Bucket;
  /** 本月（台北）開立的非作廢帳單：應收＝明細合計、已收＝至今淨收。比例由前端除 */
  month: { month: string; billed: number; received: number };
}

export function summarizeInvoices(invoices: SummaryInvoice[], today: string): InvoiceSummary {
  const month = today.slice(0, 7);
  const summary: InvoiceSummary = {
    byStatus: {
      unpaid: { count: 0, outstanding: 0 },
      partial: { count: 0, outstanding: 0 },
      paid: { count: 0 },
      overrefunded: { count: 0 },
      void: { count: 0 },
    },
    overdue: { count: 0, outstanding: 0 },
    dueSoon: { count: 0, outstanding: 0, days: DUE_SOON_DAYS },
    notDue: { count: 0, outstanding: 0 },
    month: { month, billed: 0, received: 0 },
  };

  for (const invoice of invoices) {
    const status = deriveInvoiceStatus(invoice.items, invoice.payments, invoice.voided);
    summary.byStatus[status].count += 1;
    if (status === 'void') continue;

    const { total, net } = invoiceTotals(invoice.items, invoice.payments);
    if (isOpenInvoice(status)) {
      const owed = total - net;
      (summary.byStatus[status] as Bucket).outstanding += owed;
      const bucket = summary[dueStateOn(invoice.dueDate, today)];
      bucket.count += 1;
      bucket.outstanding += owed;
    }
    if (invoice.issuedAt.slice(0, 7) === month) {
      summary.month.billed += total;
      summary.month.received += net;
    }
  }

  return summary;
}
