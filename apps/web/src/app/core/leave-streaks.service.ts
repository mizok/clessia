import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

/**
 * 連續請假滿 N 個上課日可不收費的提醒（#1732，設計稿 kb/wiki/specs/admin/finance/leave-streak-waiver.md）。
 * 整支 API 要 `manage_finance`。系統只提醒，**金額由行政自己調**，這裡不算任何金額以外的數字。
 */

export interface LeaveStreakReview {
  readonly id: string;
  readonly reviewedBy: string | null;
  readonly reviewerName: string | null;
  readonly reviewedAt: string;
}

export interface LeaveStreakDetail {
  readonly firstDay: string;
  readonly lastDay: string;
  readonly days: ReadonlyArray<{
    readonly date: string;
    readonly sessions: ReadonlyArray<{
      readonly sessionId: string;
      readonly classId: string;
      readonly className: string;
      readonly startTime: string | null;
      readonly endTime: string | null;
    }>;
  }>;
  /** 那幾天訂了而且收費的餐；`invoicedMonth` 有值＝已經開在那個月的帳單 */
  readonly meals: ReadonlyArray<{
    readonly date: string;
    readonly unitPrice: number;
    readonly invoicedMonth: string | null;
  }>;
  readonly enrollments: ReadonlyArray<{
    readonly classId: string;
    readonly className: string;
    readonly billingMode: 'monthly' | 'period' | 'session_pack' | null;
    readonly leaveDeductsSession: boolean;
    readonly sessionCount: number;
  }>;
  readonly review: LeaveStreakReview | null;
}

export interface LeaveStreakFlag {
  readonly studentId: string;
  readonly firstDay: string;
  readonly lastDay: string;
  readonly days: number;
}

@Injectable({ providedIn: 'root' })
export class LeaveStreaksService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/leave-streaks`;

  /** 帳單頁：這些學生有沒有未處理的段（最多 100 個 id） */
  flags(studentIds: readonly string[]): Observable<{ data: LeaveStreakFlag[] }> {
    return this.http.get<{ data: LeaveStreakFlag[] }>(this.endpoint, {
      params: { studentIds: studentIds.join(',') },
    });
  }

  /** 學生檔案帳單章：近期的段，含明細與已處理 */
  forStudent(studentId: string): Observable<{ threshold: number; data: LeaveStreakDetail[] }> {
    return this.http.get<{ threshold: number; data: LeaveStreakDetail[] }>(
      `${this.endpoint}/students/${studentId}`,
    );
  }

  markReviewed(
    studentId: string,
    range: { firstDay: string; lastDay: string },
  ): Observable<{ data: LeaveStreakReview }> {
    return this.http.post<{ data: LeaveStreakReview }>(
      `${this.endpoint}/students/${studentId}/reviews`,
      range,
    );
  }

  undoReview(studentId: string, reviewId: string): Observable<void> {
    return this.http.delete<void>(`${this.endpoint}/students/${studentId}/reviews/${reviewId}`);
  }
}
