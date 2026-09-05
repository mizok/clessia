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
  score: number | null;
  totalScore: number | null;
  status: ParentScoreStatus;
}

export interface ParentScoreListResponse {
  data: ParentScoreRecord[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    /** 過去 7 天內新登錄的成績筆數（登錄時間，不是考試日期） */
    recentCount: number;
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
