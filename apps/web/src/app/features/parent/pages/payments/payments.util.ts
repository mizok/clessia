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
};

export interface InvoiceGroups {
  readonly pending: ParentInvoice[];
  readonly paid: ParentInvoice[];
}

/**
 * 待付款（unpaid/partial，優先顯示）／已付款兩組——**不做「已取消」**。
 * 全系統的 `InvoiceStatus` 只有這三態，沒有 cancelled/void，舊規格的第三組
 * 是寫早了，不是這裡漏接。見 kb 設計文件 §一-6。
 */
export function groupInvoices(invoices: readonly ParentInvoice[]): InvoiceGroups {
  const pending: ParentInvoice[] = [];
  const paid: ParentInvoice[] = [];
  for (const invoice of invoices) {
    if (invoice.status === 'paid') {
      paid.push(invoice);
    } else {
      pending.push(invoice);
    }
  }
  return { pending, paid };
}

/** 最近一次付款日期——「已付款」列表顯示用，取最晚的一筆 payment（退費也算，日期還是日期） */
export function latestPaymentDate(invoice: ParentInvoice): string | null {
  if (invoice.payments.length === 0) return null;
  return invoice.payments.reduce((latest, p) => (p.paidAt > latest ? p.paidAt : latest), '');
}
