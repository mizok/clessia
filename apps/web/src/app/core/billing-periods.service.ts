import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

/**
 * 收費期間：機構自訂的具名日期區間（「2026 上學期 + 暑假」），期繳用。
 *
 * **「期」不是 enum** —— 受訪公司一年兩期，別的機構可能一年一期或照學期制
 * （billing-rules 規則 1）。**沒有分頁**，回的是裸的 `{ data }`。
 */
export interface BillingPeriod {
  id: string;
  orgId: string;
  name: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

/** `GET /billing-periods` 列表專用（#1341）：create／update 的回應不帶計數 */
export interface BillingPeriodListItem extends BillingPeriod {
  /** 與這期日期重疊的在讀期繳報名數。**不代表刪不掉** —— 擋刪除的是已開的帳單明細 */
  overlappingEnrollmentCount: number;
}

/** 儀表板「待開單」（#1293）：14 天內開始、有期繳生卻還沒開單的期 */
export interface UpcomingUnbilledPeriod {
  periodId: string;
  name: string;
  /** YYYY-MM-DD */
  startDate: string;
  daysUntil: number;
  pendingEnrollmentCount: number;
}

export interface CreateBillingPeriodInput {
  name: string;
  startDate: string;
  endDate: string;
}

export interface UpdateBillingPeriodInput {
  name?: string;
  startDate?: string;
  endDate?: string;
}

@Injectable({ providedIn: 'root' })
export class BillingPeriodsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/billing-periods`;

  list(): Observable<{ data: BillingPeriodListItem[] }> {
    return this.http.get<{ data: BillingPeriodListItem[] }>(this.endpoint);
  }

  upcomingUnbilled(): Observable<{ data: UpcomingUnbilledPeriod[] }> {
    return this.http.get<{ data: UpcomingUnbilledPeriod[] }>(`${this.endpoint}/upcoming-unbilled`);
  }

  create(input: CreateBillingPeriodInput): Observable<{ data: BillingPeriod }> {
    return this.http.post<{ data: BillingPeriod }>(this.endpoint, input);
  }

  update(id: string, input: UpdateBillingPeriodInput): Observable<{ data: BillingPeriod }> {
    return this.http.put<{ data: BillingPeriod }>(`${this.endpoint}/${id}`, input);
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.endpoint}/${id}`);
  }
}
