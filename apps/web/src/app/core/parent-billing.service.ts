import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type ParentInvoiceStatus = 'unpaid' | 'partial' | 'paid';
export type ParentInvoiceItemType = 'tuition' | 'meal' | 'session_pack' | 'adjustment';
export type ParentPaymentKind = 'payment' | 'refund';
export type ParentPaymentMethod = 'cash' | 'transfer';

export interface ParentInvoiceItem {
  id: string;
  type: ParentInvoiceItemType;
  amount: number;
  periodMonth: string | null;
}

export interface ParentPaymentRecord {
  id: string;
  kind: ParentPaymentKind;
  amount: number;
  method: ParentPaymentMethod;
  paidAt: string;
  receiptNo: number | null;
}

export interface ParentInvoice {
  id: string;
  issuedAt: string;
  dueDate: string | null;
  status: ParentInvoiceStatus;
  total: number;
  netPaid: number;
  items: ParentInvoiceItem[];
  payments: ParentPaymentRecord[];
  createdAt: string;
}

export interface ParentInvoiceListResponse {
  data: ParentInvoice[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    /** 這個孩子全部未繳清帳單的 (total − netPaid) 加總，不分頁截斷 */
    totalDue: number;
  };
}

export interface ParentInvoiceListParams {
  childId: string;
  page?: number;
  pageSize?: number;
}

@Injectable({ providedIn: 'root' })
export class ParentBillingService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/me/billing`;

  list(params: ParentInvoiceListParams): Observable<ParentInvoiceListResponse> {
    const query: Record<string, string | number> = { childId: params.childId };
    if (params.page !== undefined) query['page'] = params.page;
    if (params.pageSize !== undefined) query['pageSize'] = params.pageSize;

    return this.http.get<ParentInvoiceListResponse>(this.base, { params: query });
  }
}
