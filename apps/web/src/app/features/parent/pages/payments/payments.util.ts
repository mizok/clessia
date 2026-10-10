import type {
  ParentInvoice,
  ParentInvoiceItemType,
  ParentInvoiceStatus,
  ParentPaymentMethod,
} from '@core/parent-billing.service';

export const INVOICE_ITEM_TYPE_LABELS: Record<ParentInvoiceItemType, string> = {
  tuition: '學費',
  meal: '餐費',
  session_pack: '堂數包',
  adjustment: '調整',
};

export const PAYMENT_METHOD_LABELS: Record<ParentPaymentMethod, string> = {
  cash: '現金',
  transfer: '轉帳',
};

export const INVOICE_STATUS_LABELS: Record<ParentInvoiceStatus, string> = {
  unpaid: '待付款',
  partial: '部分繳',
  paid: '已付款',
  void: '已作廢',
  overrefunded: '多退',
};

export interface InvoiceGroups {
  readonly pending: ParentInvoice[];
  readonly paid: ParentInvoice[];
  readonly voided: ParentInvoice[];
}

/**
 * 待付款（unpaid/partial，優先顯示）／已付款／已作廢三組。
 *
 * 2026-09-30 前這裡寫「不做已取消，全系統只有三態」—— 那個前提在 #898 帳單作廢
 * 之後不成立了。作廢單自成一組（畫面預設收合）：它**不是**待付款（不該叫家長繳），
 * 也**不是**已付款（多半一毛沒收）。家長手上有紙本收費袋，帳單憑空消失比標示作廢更會引來電話。
 */
export function groupInvoices(invoices: readonly ParentInvoice[]): InvoiceGroups {
  const pending: ParentInvoice[] = [];
  const paid: ParentInvoice[] = [];
  const voided: ParentInvoice[] = [];
  for (const invoice of invoices) {
    if (invoice.status === 'void') {
      voided.push(invoice);
    } else if (invoice.status === 'paid' || invoice.status === 'overrefunded') {
      // 多退（淨額 < 0，#1034）不是待付款 —— 以前被算成「尚欠 = 應繳 − 負數」，叫家長再繳一次
      paid.push(invoice);
    } else {
      pending.push(invoice);
    }
  }
  return { pending, paid, voided };
}

/** 最近一次付款日期——「已付款」列表顯示用，取最晚的一筆 payment（退費也算，日期還是日期） */
export function latestPaymentDate(invoice: ParentInvoice): string | null {
  if (invoice.payments.length === 0) return null;
  return invoice.payments.reduce((latest, p) => (p.paidAt > latest ? p.paidAt : latest), '');
}

/** 列的主行（PP2）：家長認得的是「哪個班的錢」。有班名用班名（去重），沒有就退回項目種類（餐費、堂數包…） */
export function invoiceTitle(invoice: ParentInvoice): string {
  const names = invoice.items.map((i) => i.className ?? INVOICE_ITEM_TYPE_LABELS[i.type]);
  return [...new Set(names)].join('、');
}

export type DueTone = 'overdue' | 'pending' | 'inactive';

const day = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

/**
 * 待繳列的期限標籤（A6 `statusTag`）：逾期 N 天／N 天後到期（7 天內）／未到期。
 * `today` 由呼叫端傳（台北日曆日），這裡不碰時鐘。沒有期限日回 null。
 */
export function dueTag(
  invoice: ParentInvoice,
  today: string,
): { tone: DueTone; label: string } | null {
  if (invoice.dueDate === null) return null;
  const part = invoice.status === 'partial' ? '部分繳 · ' : '';
  const left = Math.round((day(invoice.dueDate) - day(today)) / 86_400_000);
  if (left < 0) return { tone: 'overdue', label: `${part}逾期 ${-left} 天` };
  if (left === 0) return { tone: 'pending', label: `${part}今天到期` };
  if (left <= 7) return { tone: 'pending', label: `${part}${left} 天後到期` };
  return { tone: 'inactive', label: `${part}未到期` };
}

/** `YYYY-MM-DD` → `M/D`（A6 `md`） */
export function monthDay(date: string): string {
  return `${+date.slice(5, 7)}/${+date.slice(8, 10)}`;
}
