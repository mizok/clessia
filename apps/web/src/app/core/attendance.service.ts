import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type AttendanceStatus = 'present' | 'absent' | 'on_leave';
export type AttendanceSessionStatus = 'scheduled' | 'completed' | 'cancelled';

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: '到課',
  absent: '缺席',
  on_leave: '請假',
};

export const ATTENDANCE_STATUS_SEVERITIES: Record<
  AttendanceStatus,
  'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'
> = {
  present: 'success',
  absent: 'danger',
  on_leave: 'warn',
};

export interface AttendanceRecord {
  id: string;
  orgId: string;
  studentId: string;
  studentName: string;
  eventId: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  campusName: string | null;
  className: string | null;
  status: AttendanceStatus;
  note: string | null;
  recordedBy: string | null;
  recordedByRole: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceListResponse {
  data: AttendanceRecord[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface AttendanceQueryParams {
  campusId?: string;
  classId?: string;
  studentId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: AttendanceStatus;
  page?: number;
  pageSize?: number;
}

export interface UpdateAttendanceInput {
  status?: AttendanceStatus;
  note?: string | null;
}

export interface EventSessionSummary {
  /**
   * 課堂本身的 id。**這才是穩定的鍵** —— `eventId` 可能是 null，
   * 拿它當 `@for` 的 track key 會讓停課的課堂互相撞 key。
   */
  sessionId: string;
  /**
   * 出勤事件的 id。**停課的課堂沒有** —— 出勤事件是列表時才補建的，
   * 而停課的課堂刻意不補（不會發生的課不該在行事曆上長出一筆）。
   * `null` 就是點不了名，呼叫端要據此關掉點名入口，不要當成空字串硬送。
   */
  eventId: string | null;
  /** 停課要顯示成灰底；預設查詢不含 `cancelled`，要它得明式傳 `statuses` */
  status: AttendanceSessionStatus;
  /** 實際上課的老師跟課表排定的不一致。後端算好的，前端不要自己比對 */
  isSubstitute: boolean;
  /** 這個班在這一天排了幾場校內考。0 就是沒有 */
  examCount: number;
  classId: string;
  className: string;
  courseName: string | null;
  teacherName: string | null;
  campusId: string | null;
  campusName: string | null;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  enrolledCount: number;
  presentCount: number;
  onLeaveCount: number;
  absentCount: number;
  takenAt: string | null;
}

export interface RosterStudent {
  studentId: string;
  studentName: string;
  grade: string | null;
  school: string | null;
  recordId: string | null;
  status: 'present' | 'absent' | 'on_leave' | null;
}

export interface AttendanceRoster {
  eventId: string;
  takenAt: string | null;
  students: RosterStudent[];
}

export interface AttendanceSessionListResponse {
  data: EventSessionSummary[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface BatchAttendanceUpdate {
  eventId: string;
  updates: { studentId: string; status: 'present' | 'absent' }[];
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/api/attendance`;

  list(params: AttendanceQueryParams): Observable<AttendanceListResponse> {
    let httpParams = new HttpParams();
    if (params.campusId) httpParams = httpParams.set('campusId', params.campusId);
    if (params.classId) httpParams = httpParams.set('classId', params.classId);
    if (params.studentId) httpParams = httpParams.set('studentId', params.studentId);
    if (params.dateFrom) httpParams = httpParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) httpParams = httpParams.set('dateTo', params.dateTo);
    if (params.status) httpParams = httpParams.set('status', params.status);
    if (params.page) httpParams = httpParams.set('page', params.page);
    if (params.pageSize) httpParams = httpParams.set('pageSize', params.pageSize);
    return this.http.get<AttendanceListResponse>(this.baseUrl, { params: httpParams });
  }

  update(id: string, input: UpdateAttendanceInput): Observable<AttendanceRecord> {
    return this.http.patch<AttendanceRecord>(`${this.baseUrl}/${id}`, input);
  }

  sessions(params: {
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    campusId?: string;
    courseIds?: string[];
    classIds?: string[];
    statuses?: AttendanceSessionStatus[];
    page?: number;
    pageSize?: number;
  }): Observable<AttendanceSessionListResponse> {
    let p = new HttpParams();
    if (params.date) p = p.set('date', params.date);
    if (params.dateFrom) p = p.set('dateFrom', params.dateFrom);
    if (params.dateTo) p = p.set('dateTo', params.dateTo);
    if (params.campusId) p = p.set('campusId', params.campusId);
    if (params.courseIds && params.courseIds.length > 0) {
      p = p.set('courseIds', params.courseIds.join(','));
    }
    if (params.classIds && params.classIds.length > 0)
      p = p.set('classIds', params.classIds.join(','));
    if (params.statuses && params.statuses.length > 0)
      p = p.set('statuses', params.statuses.join(','));
    if (params.page) p = p.set('page', params.page);
    if (params.pageSize) p = p.set('pageSize', params.pageSize);
    return this.http.get<AttendanceSessionListResponse>(`${this.baseUrl}/sessions`, { params: p });
  }

  roster(eventId: string): Observable<AttendanceRoster> {
    return this.http.get<AttendanceRoster>(`${this.baseUrl}/roster/${eventId}`);
  }

  batchUpdate(input: BatchAttendanceUpdate): Observable<{ updated: number; takenAt: string }> {
    return this.http.patch<{ updated: number; takenAt: string }>(`${this.baseUrl}/batch`, input);
  }
}
