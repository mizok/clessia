import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

/** `GET /api/me/meals` 的一筆（#1117）：只有有訂的那天；沒有餐別、沒有行政備註 */
export interface ParentMealRecord {
  date: string;
  unitPrice: number;
  /** 行政可翻的「收不收」開關；不收的那天 `amount` 是 0 */
  chargeable: boolean;
  amount: number;
  /** 已經進帳單（月結蓋過章） */
  settled: boolean;
}

export interface ParentMealListResponse {
  data: ParentMealRecord[];
  meta: { months: Array<{ month: string; count: number; totalAmount: number }> };
}

@Injectable({ providedIn: 'root' })
export class ParentMealsService {
  private readonly http = inject(HttpClient);

  /** 區間必填、最多 366 天（API 擋） */
  list(params: {
    childId: string;
    dateFrom: string;
    dateTo: string;
  }): Observable<ParentMealListResponse> {
    return this.http.get<ParentMealListResponse>(`${environment.apiUrl}/api/me/meals`, { params });
  }
}
