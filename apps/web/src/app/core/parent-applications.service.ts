import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

/**
 * 家長端送申請（#1727，設計稿 kb/wiki/specs/parent/applications.md）：報名申請、試聽申請、可加選的開課班目錄。
 * 錯誤回 `{ error, code }`，頁面依 code 顯示在表單裡。
 */

export type EnrollmentRequestStatus =
  'pending' | 'waitlist' | 'awaiting_payment' | 'completed' | 'rejected' | 'cancelled' | 'expired';

export interface ParentEnrollmentRequest {
  id: string;
  studentId: string;
  studentName: string | null;
  classId: string;
  className: string | null;
  status: EnrollmentRequestStatus;
  preferredStartDate: string | null;
  note: string | null;
  rejectReason: string | null;
  billingMode: 'monthly' | 'period' | 'session_pack' | null;
  createdAt: string | null;
  /** 待付款時：核准開的那張帳單（#1726）；其他狀態或帳單作廢沒重開 → null */
  invoice: {
    id: string;
    invoiceNo: string | null;
    total: number;
    netPaid: number;
    dueDate: string | null;
    status: string;
  } | null;
  /** 待付款時：申請班級分校的帳戶（分校 → 機構預設）；沒設定 → null */
  paymentInfo: string | null;
}

export interface CreateEnrollmentRequest {
  studentId: string;
  classId: string;
  preferredStartDate?: string;
  note?: string;
  /** 額滿時明確同意登記候補（額滿與否由伺服器數） */
  waitlist?: boolean;
  billingMode?: 'monthly' | 'period';
}

export type TrialRequestStatus = 'pending' | 'scheduled' | 'completed' | 'cancelled';

export interface ParentTrialRequest {
  id: string;
  studentId: string;
  studentName: string | null;
  courseId: string;
  courseName: string | null;
  status: TrialRequestStatus;
  preferredTimes: string | null;
  note: string | null;
  createdAt: string | null;
  /** 排定的試聽日期與時間（`HH:MM`）；還沒排 → null（管理端填日期是 #1747） */
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  /** 課程所屬分校（#1750）：要取消或改時間得打電話；讀不到或沒填 → null */
  campusName: string | null;
  campusPhone: string | null;
}

export interface CreateTrialRequest {
  studentId: string;
  courseIds: string[];
  preferredTimes?: string;
  note?: string;
}

export interface ParentCatalogClass {
  classId: string;
  className: string;
  gradeLevels: string[];
  courseId: string | null;
  courseName: string | null;
  subject: string | null;
  courseDescription: string | null;
  campusName: string | null;
  /** 1=週一 … 7=週日 */
  slots: Array<{
    weekday: number;
    startTime: string;
    endTime: string;
    /** 還沒生效的未來時段＝哪天起；已生效＝null（#1100 #22） */
    effectiveFrom?: string | null;
  }>;
  maxStudents: number;
  remainingSeats: number;
  fee: { amount: number; billingMode: 'monthly' | 'period' | 'session_pack' } | null;
  isRecommended: boolean;
  teacherNames: string[];
  matchesGrade: boolean;
  /** 這個孩子今天已在這班 */
  enrolled: boolean;
  /** 跟孩子在籍的哪一班撞時間；沒撞 → null */
  conflictsWith: string | null;
}

@Injectable({ providedIn: 'root' })
export class ParentApplicationsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/me`;

  enrollmentRequests(): Observable<{ data: ParentEnrollmentRequest[] }> {
    return this.http.get<{ data: ParentEnrollmentRequest[] }>(`${this.base}/enrollment-requests`);
  }

  createEnrollmentRequest(body: CreateEnrollmentRequest): Observable<ParentEnrollmentRequest> {
    return this.http.post<ParentEnrollmentRequest>(`${this.base}/enrollment-requests`, body);
  }

  cancelEnrollmentRequest(id: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `${this.base}/enrollment-requests/${id}/cancel`,
      {},
    );
  }

  trialRequests(): Observable<{ data: ParentTrialRequest[] }> {
    return this.http.get<{ data: ParentTrialRequest[] }>(`${this.base}/trial-requests`);
  }

  /** 一門課一筆；回這次建立的全部 */
  createTrialRequests(body: CreateTrialRequest): Observable<{ data: ParentTrialRequest[] }> {
    return this.http.post<{ data: ParentTrialRequest[] }>(`${this.base}/trial-requests`, body);
  }

  catalog(childId: string): Observable<{ data: ParentCatalogClass[] }> {
    return this.http.get<{ data: ParentCatalogClass[] }>(`${this.base}/catalog`, {
      params: { childId },
    });
  }
}
