import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type AttendanceStatus = 'present' | 'absent' | 'on_leave';

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
  eventId: string;
  classId: string;
  className: string;
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
  }): Observable<EventSessionSummary[]> {
    let p = new HttpParams();
    if (params.date) p = p.set('date', params.date);
    if (params.dateFrom) p = p.set('dateFrom', params.dateFrom);
    if (params.dateTo) p = p.set('dateTo', params.dateTo);
    if (params.campusId) p = p.set('campusId', params.campusId);
    return this.http.get<EventSessionSummary[]>(`${this.baseUrl}/sessions`, { params: p });
  }

  roster(eventId: string): Observable<AttendanceRoster> {
    return this.http.get<AttendanceRoster>(`${this.baseUrl}/roster/${eventId}`);
  }

  batchUpdate(input: BatchAttendanceUpdate): Observable<{ updated: number; takenAt: string }> {
    return this.http.patch<{ updated: number; takenAt: string }>(`${this.baseUrl}/batch`, input);
  }
}
