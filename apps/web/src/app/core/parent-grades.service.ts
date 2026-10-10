import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type ParentScoreType = 'academy' | 'school';
export type ParentScoreStatus = 'scored' | 'absent' | 'makeup';

export interface ParentScoreRecord {
  id: string;
  type: ParentScoreType;
  examName: string;
  examDate: string;
  subjectName: string | null;
  /** 課程名（#1314 PG1）：段考、對不上報名的班 → null */
  className: string | null;
  /** 這筆成績的登錄時間（NEW 標籤與「M/D 登錄」用，不是考試日期） */
  createdAt: string;
  score: number | null;
  totalScore: number | null;
  status: ParentScoreStatus;
  /** 考試描述：校內考的範圍說明，段考一律 null（#1076）。有值的那筆可以展開看 */
  description: string | null;
}

/** 機構的期（`billing_periods`）＝成績頁的「學期」篩選（#1076） */
export interface ParentGradePeriod {
  id: string;
  name: string;
  /** `YYYY-MM-DD`，含頭尾 */
  startDate: string;
  endDate: string;
}

export interface ParentScoreListResponse {
  data: ParentScoreRecord[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    /** 過去 7 天內新登錄的成績筆數（登錄時間，不是考試日期） */
    recentCount: number;
    /** 機構的期，`startDate` 新到舊 */
    periods: ParentGradePeriod[];
  };
}

export interface ParentScoreListParams {
  childId: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

@Injectable({ providedIn: 'root' })
export class ParentGradesService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/me/grades`;

  list(params: ParentScoreListParams): Observable<ParentScoreListResponse> {
    const query: Record<string, string | number> = { childId: params.childId };
    if (params.dateFrom !== undefined) query['dateFrom'] = params.dateFrom;
    if (params.dateTo !== undefined) query['dateTo'] = params.dateTo;
    if (params.page !== undefined) query['page'] = params.page;
    if (params.pageSize !== undefined) query['pageSize'] = params.pageSize;

    return this.http.get<ParentScoreListResponse>(this.base, { params: query });
  }
}
