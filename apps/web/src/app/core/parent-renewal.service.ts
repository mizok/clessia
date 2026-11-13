import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

/** `GET /api/me/renewal-preview`（#1121）：下一期會續的期繳課與預估金額 */
export interface ParentRenewalItem {
  enrollmentId: string;
  courseName: string | null;
  currentClassName: string;
  nextClassName: string;
  /** 下期換到原班設定的下一班 */
  upgraded: boolean;
  /** 1=週一 … 7=週日 */
  schedules: Array<{ weekday: number; startTime: string; endTime: string }>;
  teacherNames: string[];
  /** 算不出來 → null（前端寫「待確認」） */
  estimatedAmount: number | null;
  estimateSource: 'enrollment' | 'next_class_default' | null;
}

export type RenewalRequestKind = 'transfer' | 'stop' | 'billing_mode';

/** 續課異動申請（#1122）；`pending`＝這個孩子暫停自動開單 */
export interface ParentRenewalRequest {
  id: string;
  enrollmentId: string;
  kind: RenewalRequestKind;
  detail: string;
  note: string | null;
  status: 'pending' | 'resolved' | 'withdrawn';
  createdAt: string;
}

export interface CreateRenewalRequestInput {
  childId: string;
  enrollmentId: string;
  kind: RenewalRequestKind;
  /** 想怎麼改（1～500） */
  detail: string;
  note?: string | null;
}

export interface ParentRenewalPreview {
  nextPeriod: { name: string; startDate: string; endDate: string } | null;
  items: ParentRenewalItem[];
  /** 有在讀的月繳報名（月繳不列在預覽裡） */
  hasMonthlyEnrollments: boolean;
  /** 處理中的續課異動（#1122） */
  pendingRequest: ParentRenewalRequest | null;
}

@Injectable({ providedIn: 'root' })
export class ParentRenewalService {
  private readonly http = inject(HttpClient);

  preview(childId: string): Observable<{ data: ParentRenewalPreview }> {
    return this.http.get<{ data: ParentRenewalPreview }>(
      `${environment.apiUrl}/api/me/renewal-preview`,
      { params: { childId } },
    );
  }

  createRequest(input: CreateRenewalRequestInput): Observable<ParentRenewalRequest> {
    return this.http.post<ParentRenewalRequest>(
      `${environment.apiUrl}/api/me/renewal-requests`,
      input,
    );
  }

  withdrawRequest(id: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `${environment.apiUrl}/api/me/renewal-requests/${id}/withdraw`,
      {},
    );
  }
}
