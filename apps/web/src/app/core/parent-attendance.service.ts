import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

/** 三態，跟系統的既有出勤狀態一致——**沒有「遲到」**，全系統從來沒有這個狀態 */
export type ParentAttendanceStatus = 'present' | 'absent' | 'on_leave';

export interface ParentAttendanceRecord {
  id: string;
  eventId: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  campusName: string | null;
  className: string | null;
  status: ParentAttendanceStatus;
  note: string | null;
}

export interface ParentAttendanceListResponse {
  data: ParentAttendanceRecord[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    /** 缺席＋請假的合計——欄位還沒拆開前只有這一個數字，見 kb 設計文件 §一-3 */
    monthlyAbsentCount: number;
  };
}

export interface ParentAttendanceListParams {
  childId: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

@Injectable({ providedIn: 'root' })
export class ParentAttendanceService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/me/attendance`;

  list(params: ParentAttendanceListParams): Observable<ParentAttendanceListResponse> {
    const query: Record<string, string | number> = { childId: params.childId };
    if (params.dateFrom !== undefined) query['dateFrom'] = params.dateFrom;
    if (params.dateTo !== undefined) query['dateTo'] = params.dateTo;
    if (params.page !== undefined) query['page'] = params.page;
    if (params.pageSize !== undefined) query['pageSize'] = params.pageSize;

    return this.http.get<ParentAttendanceListResponse>(this.base, { params: query });
  }
}
