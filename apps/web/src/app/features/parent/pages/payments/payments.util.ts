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
    } else if (invoice.status === 'paid') {
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
