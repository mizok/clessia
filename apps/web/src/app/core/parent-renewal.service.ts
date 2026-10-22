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

export interface ParentRenewalPreview {
  nextPeriod: { name: string; startDate: string; endDate: string } | null;
  items: ParentRenewalItem[];
  /** 有在讀的月繳報名（月繳不列在預覽裡） */
  hasMonthlyEnrollments: boolean;
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
}
