import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

/**
 * 帳單與收款。見 kb/wiki/specs/admin/finance/payments.md 與
 * kb/wiki/architecture/admin-payments-page.md。
 *
 * **狀態不是欄位** —— `status` / `total` / `netPaid` 全由後端從 items 與 payments
 * 推導後回傳（`apps/api/src/lib/invoice-status.ts`）。前端照呈現，不要自己再算一次：
 * 兩邊各算一次就會有兩個版本的真相。
 */

/** 三態。逾期是**正交的衍生標記**，不是第四種狀態（billing-rules 規則 4） */
export type InvoiceStatus = 'unpaid' | 'partial' | 'paid';

export type InvoiceItemType = 'tuition' | 'meal' | 'session_pack' | 'adjustment';
export type PaymentKind = 'payment' | 'refund';
export type PaymentMethod = 'cash' | 'transfer';
export type ReminderMethod = 'line' | 'phone' | 'other';

export const INVOICE_STATUS_LABELS: Readonly<Record<InvoiceStatus, string>> = {
  unpaid: '未繳',
  partial: '部分繳',
  paid: '繳清',
};

export const INVOICE_ITEM_TYPE_LABELS: Readonly<Record<InvoiceItemType, string>> = {
  tuition: '學費',
  meal: '餐費',
  session_pack: '堂數包',
  adjustment: '調整',
};

export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  cash: '現金',
  transfer: '轉帳',
};

export const REMINDER_METHOD_LABELS: Readonly<Record<ReminderMethod, string>> = {
  line: 'LINE',
  phone: '電話',
  other: '其他',
};

export interface InvoiceItem {
  id: string;
  type: InvoiceItemType;
  enrollmentId: string | null;
  /** 整數。`adjustment` 可以是負數 */
  amount: number;
  billingPeriodId: string | null;
  periodMonth: string | null;
  note: string | null;
}

export interface PaymentRecord {
  id: string;
  /** 退費是**負向收款**，不是帳單狀態也不是另一張帳單 */
  kind: PaymentKind;
  /** 恆正 —— 正負由 `kind` 決定 */
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  proofPath: string | null;
  /** DB trigger 取號。沒有收款就沒有收據可印 */
  receiptNo: number | null;
  note: string | null;
  recordedBy: string | null;
}

export interface Invoice {
  id: string;
  orgId: string;
  studentId: string;
  studentName: string | null;
  issuedAt: string;
  /** 可為 null —— 沒有到期日就不會逾期 */
  dueDate: string | null;
  note: string | null;
  /** 推導值 */
  status: InvoiceStatus;
  /** 明細加總 */
  total: number;
  /** 收款減退費 */
  netPaid: number;
  items: InvoiceItem[];
  payments: PaymentRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface PaymentReminder {
  id: string;
  method: ReminderMethod;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface InvoiceQueryParams {
  /** 後端只吃 uuid，**不吃姓名關鍵字** —— 姓名搜尋走 student-autocomplete 換出 id */
  studentId?: string;
  /** 過了 due_date 且還沒繳清。行政的追繳清單 */
  overdue?: boolean;
  page?: number;
  pageSize?: number;
}

export interface InvoiceListMeta {
  /**
   * ⚠️ **非 overdue 路徑目前回的是當頁筆數不是總數**（後端在 `.range()` 切頁之後才
   * 算 `rows.length`，見 `apps/api/src/routes/invoices.ts` 的列表 handler）。
   * 已回報 billing-api 席。修好之前呼叫端**不要**拿它算總頁數 ——
   * 分頁請用「當頁滿 pageSize 就還有下一頁」。
   */
  total: number;
  page: number;
  pageSize: number;
}

export interface InvoiceListResponse {
  data: Invoice[];
  meta: InvoiceListMeta;
}

export interface CreateInvoiceItemInput {
  type: InvoiceItemType;
  enrollmentId?: string;
  amount: number;
  billingPeriodId?: string;
  periodMonth?: string;
  note?: string;
}

export interface CreateInvoiceInput {
  studentId: string;
  issuedAt?: string;
  /** 沒給的話後端用 org 的 `invoice_due_days` 算（預設 14 天） */
  dueDate?: string | null;
  note?: string;
  items?: CreateInvoiceItemInput[];
}

export interface RecordPaymentInput {
  kind?: PaymentKind;
  /** 正整數 —— 退費也填正數，由 `kind` 決定方向 */
  amount: number;
  method: PaymentMethod;
  paidAt?: string;
  proofPath?: string;
  note?: string;
}

export interface CreateReminderInput {
  method: ReminderMethod;
  note?: string;
}

@Injectable({ providedIn: 'root' })
export class InvoicesService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/invoices`;

  list(params?: InvoiceQueryParams): Observable<InvoiceListResponse> {
    return this.http.get<InvoiceListResponse>(this.endpoint, { params: toQuery(params) });
  }

  get(id: string): Observable<{ data: Invoice }> {
    return this.http.get<{ data: Invoice }>(`${this.endpoint}/${id}`);
  }

  create(input: CreateInvoiceInput): Observable<{ data: Invoice }> {
    return this.http.post<{ data: Invoice }>(this.endpoint, input);
  }

  addItem(id: string, input: CreateInvoiceItemInput): Observable<{ data: Invoice }> {
    return this.http.post<{ data: Invoice }>(`${this.endpoint}/${id}/items`, input);
  }

  removeItem(id: string, itemId: string): Observable<{ data: Invoice }> {
    return this.http.delete<{ data: Invoice }>(`${this.endpoint}/${id}/items/${itemId}`);
  }

  /** 收款與退費都走這支，差別只有 `kind`。回的是**整張帳單**（狀態已重新推導） */
  recordPayment(id: string, input: RecordPaymentInput): Observable<{ data: Invoice }> {
    return this.http.post<{ data: Invoice }>(`${this.endpoint}/${id}/payments`, input);
  }

  listReminders(id: string): Observable<{ data: PaymentReminder[] }> {
    return this.http.get<{ data: PaymentReminder[] }>(`${this.endpoint}/${id}/reminders`);
  }

  createReminder(id: string, input: CreateReminderInput): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.endpoint}/${id}/reminders`, input);
  }
}

/** `overdue: false` 被當成「沒給」是這種轉換最典型的錯法，所以只在 true 時送 */
function toQuery(params?: InvoiceQueryParams): Record<string, string> {
  if (!params) return {};

  const query: Record<string, string> = {};
  if (params.studentId) query['studentId'] = params.studentId;
  if (params.overdue) query['overdue'] = 'true';
  if (params.page !== undefined) query['page'] = String(params.page);
  if (params.pageSize !== undefined) query['pageSize'] = String(params.pageSize);
  return query;
}
