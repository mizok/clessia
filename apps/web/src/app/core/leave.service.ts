import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

export interface LeaveRequest {
  id: string;
  orgId: string;
  studentId: string;
  studentName: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
  submittedBy: string;
  submittedByRole: 'parent' | 'admin';
  submittedByName: string | null;
  createdAt: string;
}

export interface LeaveListResponse {
  data: LeaveRequest[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface LeaveQueryParams {
  campusId?: string;
  studentId?: string;
  dateFrom?: string;
  dateTo?: string;
  coverDate?: string;
  page?: number;
  pageSize?: number;
}

// PATCH：每個欄位都是 optional，沒帶的維持原值。
// **沒有 `studentId`** —— 換學生等於撤掉再開一張，走刪除＋新增那條路。
export interface UpdateLeaveInput {
  startDate?: string;
  endDate?: string;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string | null;
}

export interface CreateLeaveInput {
  studentId: string;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string | null;
}

@Injectable({ providedIn: 'root' })
export class LeaveService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/api/leaves`;

  list(params: LeaveQueryParams): Observable<LeaveListResponse> {
    let httpParams = new HttpParams();
    if (params.campusId) httpParams = httpParams.set('campusId', params.campusId);
    if (params.studentId) httpParams = httpParams.set('studentId', params.studentId);
    if (params.dateFrom) httpParams = httpParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) httpParams = httpParams.set('dateTo', params.dateTo);
    if (params.coverDate) httpParams = httpParams.set('coverDate', params.coverDate);
    if (params.page) httpParams = httpParams.set('page', params.page);
    if (params.pageSize) httpParams = httpParams.set('pageSize', params.pageSize);
    return this.http.get<LeaveListResponse>(this.baseUrl, { params: httpParams });
  }

  create(input: CreateLeaveInput): Observable<LeaveRequest> {
    return this.http.post<LeaveRequest>(this.baseUrl, input);
  }

  update(id: string, input: UpdateLeaveInput): Observable<LeaveRequest> {
    return this.http.patch<LeaveRequest>(`${this.baseUrl}/${id}`, input);
  }

  delete(id: string, mode: 'truncate' | 'full' = 'truncate'): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`, {
      params: new HttpParams().set('mode', mode),
    });
  }
}
