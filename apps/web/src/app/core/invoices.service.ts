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

/**
 * 三態推導 ＋ 作廢。逾期是**正交的衍生標記**，不是狀態（billing-rules 規則 4）。
 * `void` 不是推導的，它來自 `voidedAt`（#898）。
 */
/** `overrefunded`：淨額 < 0（退的比收的多，#1034）—— 不在等錢，跟後端同名狀態同一個定義 */
export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'void' | 'overrefunded';

export type InvoiceItemType = 'tuition' | 'meal' | 'session_pack' | 'adjustment';
export type PaymentKind = 'payment' | 'refund';
export type PaymentMethod = 'cash' | 'transfer';
export type ReminderMethod = 'line' | 'phone' | 'other';

export const INVOICE_STATUS_LABELS: Readonly<Record<InvoiceStatus, string>> = {
  unpaid: '未繳',
  partial: '部分繳',
  paid: '繳清',
  void: '已作廢',
  overrefunded: '多退',
};

/**
 * 「還在等錢」的唯一定義，跟後端 `lib/invoice-status.ts` 的 `isOpenInvoice` 同一條。
 * 列舉「是」而不是排除「不是」—— `status !== 'paid'` 會把作廢單算成欠全額（#898）。
 */
export function isOpenInvoice(status: InvoiceStatus): boolean {
  return status === 'unpaid' || status === 'partial';
}

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
  /** #1314 (a)：帳單列表的年級欄 */
  studentGrade: string | null;
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
  /** #898。作廢不可撤銷；三個欄位同進同出（voidedBy 可能因帳號被刪而是 null） */
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
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

export type DueState = 'overdue' | 'dueSoon' | 'notDue';

export interface InvoiceQueryParams {
  /** 只吃 uuid；姓名關鍵字用 `search` */
  studentId?: string;
  /** 學生姓名或任一位家長姓名（部分比對，#1314 (a)）。帳單編號搜尋待 #1459 */
  search?: string;
  /**
   * 催繳的三個子集(#639)。**同一個母體(未繳清)、差別只在日期那一半**,
   * 所以 UI 做成三選一;並用的話是交集,不是聯集。
   *
   * | | 語意 | 沒有到期日的帳單 |
   * | --- | --- | --- |
   * | `outstanding` | 未繳清 —— **催繳母體** | **含** |
   * | `overdue` | 已逾期未繳清 | 不含 |
   * | `dueWithin` | N 天內到期且未繳清 | 不含 |
   *
   * 「沒有到期日 = 還沒發收費袋」那一欄是使用者 2026-09-07 裁的:
   * **帳單存在 = 這筆錢記下來了**(所以算未繳清),**但沒告訴家長期限就不該去催**。
   */
  outstanding?: boolean;
  /** 過了 due_date 且還沒繳清。行政的追繳清單 */
  overdue?: boolean;
  /** N 天內到期且未繳清。今天與第 N 天都含;`0` = 只看今天到期 */
  dueWithin?: number;
  /** 推導出來的狀態（PR #64 加的）。**與 `overdue` 可並用** —— 「部分繳 + 逾期」是常見組合 */
  status?: InvoiceStatus;
  /**
   * 未繳清的互斥章（#1314 P1）。判準在後端 `lib/invoice-overdue.ts` 的 `dueStateOn`：
   * `dueSoon` = 今天到第 `summary.dueSoon.days` 天（含）；`notDue` 含沒有到期日的。
   * 與上面三者並用是交集
   */
  dueState?: DueState;
  /** 'YYYY-MM' = 只看這個月開立的（匯出，#1314 P4） */
  issuedMonth?: string;
  page?: number;
  pageSize?: number;
}

export interface InvoiceListMeta {
  /**
   * **篩後全體的筆數**，兩條查詢路徑都是（PR #64 修正）：沒帶推導條件時是 DB 的
   * `count: 'exact'`，帶了 `status` / `overdue` 時是後端全撈篩完之後、
   * `sliceDerivedPage` 切頁**之前**的筆數。可以拿來算總頁數。
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

interface SummaryBucket {
  count: number;
  outstanding: number;
}

/**
 * `GET /invoices/summary`（#1382）。金額與張數都由後端加總，前端只顯示。
 *
 * 未繳清的三章 `overdue`／`dueSoon`／`notDue`（#1314 P1）互斥、聯集＝ `unpaid`＋`partial`。
 * **章名的天數讀 `dueSoon.days`**，不要在前端另存一份
 */
export interface InvoiceSummary {
  byStatus: {
    unpaid: SummaryBucket;
    partial: SummaryBucket;
    paid: { count: number };
    overrefunded: { count: number };
    void: { count: number };
  };
  overdue: SummaryBucket;
  dueSoon: SummaryBucket & { days: number };
  notDue: SummaryBucket;
  /** 未繳清總待收（#1314 P3）＝三章 outstanding 和；不含作廢與多退 */
  outstanding: number;
  /** 本月（台北）開立的非作廢帳單：應收＝明細合計、已收＝至今淨收 */
  month: { month: string; billed: number; received: number };
}

@Injectable({ providedIn: 'root' })
export class InvoicesService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/invoices`;

  list(params?: InvoiceQueryParams): Observable<InvoiceListResponse> {
    return this.http.get<InvoiceListResponse>(this.endpoint, { params: toQuery(params) });
  }

  /** 帶 `studentId` 只算該生（學生檔案帳單章，#1314 P3） */
  summary(params?: { studentId?: string }): Observable<InvoiceSummary> {
    const query: Record<string, string> = {};
    if (params?.studentId) query['studentId'] = params.studentId;
    return this.http.get<InvoiceSummary>(`${this.endpoint}/summary`, { params: query });
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

  /**
   * 作廢（#898）。**不可撤銷**。淨額 ≠ 0、已作廢、連到堂數包時後端回 409，
   * `error` 是給行政看的完整句子（含下一步該做什麼），直接顯示即可。
   */
  voidInvoice(id: string, reason: string): Observable<{ data: Invoice }> {
    return this.http.post<{ data: Invoice }>(`${this.endpoint}/${id}/void`, { reason });
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
  if (params.search) query['search'] = params.search;
  if (params.outstanding) query['outstanding'] = 'true';
  if (params.overdue) query['overdue'] = 'true';
  // `dueWithin: 0` 是有效值(只看今天到期)—— 用 `!= null` 不是 truthy,
  // 否則「今天到期」那一批會靜靜變成「沒篩」
  if (params.dueWithin !== undefined && params.dueWithin !== null) {
    query['dueWithin'] = String(params.dueWithin);
  }
  if (params.status) query['status'] = params.status;
  if (params.dueState) query['dueState'] = params.dueState;
  if (params.issuedMonth) query['issuedMonth'] = params.issuedMonth;
  if (params.page !== undefined) query['page'] = String(params.page);
  if (params.pageSize !== undefined) query['pageSize'] = String(params.pageSize);
  return query;
}
