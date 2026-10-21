import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '@env/environment';
import type { BillingMode } from './fee-templates.service';

/** 頁面分組 → 伺服器把報名、試聽兩套狀態對到同一組（#1707） */
export type ParentRequestGroup = 'pending' | 'active' | 'done' | 'rejected' | 'cancelled';
export type TrialRequestStatus = 'pending' | 'scheduled' | 'completed' | 'cancelled';

/** 家長登入後在 app 送的報名／試聽申請（`/api/parent-requests`） */
export interface ParentRequest {
  id: string;
  kind: 'enrollment' | 'trial';
  /** 報名：pending／waitlist／awaiting_payment／completed／rejected／cancelled／expired；試聽見 TrialRequestStatus */
  status: string;
  createdAt: string;
  student: { id: string; name: string };
  parent: { name: string | null; phone: string | null };
  target: { name: string; campusName: string | null };
  preferredStartDate: string | null;
  preferredTimes: string | null;
  note: string | null;
  rejectReason: string | null;
  /** 報名才有：申請的班（試聽是 null） */
  classId: string | null;
  /** 家長在 app 選的計費模式（#1745）；沒選 null */
  billingMode: BillingMode | null;
  /** 班級預設價目表（只用於預選，#1727 B (b)） */
  defaultFeeTemplateId: string | null;
}

/** `POST /enrollment/:id/approve`（#1726）：沒給的欄位由伺服器決定（試算金額、機構預設期限） */
export interface ApproveEnrollmentRequestInput {
  billingMode: BillingMode;
  feeTemplateId: string;
  agreedAmount?: number;
  /** 填了 agreedAmount 必填 */
  adjustmentNote?: string;
  /** YYYY-MM-DD */
  effectiveFrom: string;
  /** 行政改過的首期金額；跟試算不同要附 amountNote */
  amount?: number;
  amountNote?: string;
  /** YYYY-MM-DD；不給 = 開帳日 + 機構設定天數 */
  dueDate?: string;
  /** 堂數制必填 */
  sessionCount?: number;
  skipConflictCheck?: boolean;
}

export interface ApproveEnrollmentRequestResult {
  enrollmentId: string;
  invoiceId: string;
  invoiceNo: string | null;
  amount: number;
  dueDate: string;
}

@Injectable({ providedIn: 'root' })
export class ParentRequestsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/parent-requests`;

  list(params: {
    group: ParentRequestGroup;
    kind?: 'enrollment' | 'trial' | null;
  }): Observable<{ data: ParentRequest[] }> {
    const query: Record<string, string> = { group: params.group };
    if (params.kind) query['kind'] = params.kind;
    return this.http.get<{ data: ParentRequest[] }>(this.endpoint, { params: query });
  }

  /** 拒絕（原因家長看得到） */
  reject(id: string, rejectReason: string): Observable<{ data: ParentRequest }> {
    return this.http.patch<{ data: ParentRequest }>(`${this.endpoint}/enrollment/${id}`, {
      status: 'rejected',
      rejectReason,
    });
  }

  /** 核准＝一個交易建待繳費報名、開帳單、申請轉待付款（#1726）；要 manage_finance */
  approve(
    id: string,
    body: ApproveEnrollmentRequestInput,
  ): Observable<{ data: ApproveEnrollmentRequestResult }> {
    return this.http.post<{ data: ApproveEnrollmentRequestResult }>(
      `${this.endpoint}/enrollment/${id}/approve`,
      body,
    );
  }

  setTrialStatus(id: string, status: TrialRequestStatus): Observable<{ data: ParentRequest }> {
    return this.http.patch<{ data: ParentRequest }>(`${this.endpoint}/trial/${id}`, { status });
  }
}
