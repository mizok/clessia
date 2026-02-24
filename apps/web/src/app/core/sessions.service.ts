import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

export interface Session {
  id: string;
  sessionDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  status: 'scheduled' | 'completed' | 'cancelled';
  classId: string;
  className: string;
  courseId: string;
  courseName: string;
  campusId: string;
  campusName: string;
  teacherId: string;
  teacherName: string;
  hasChanges: boolean;
}

export interface ScheduleChange {
  id: string;
  changeType: 'reschedule' | 'substitute' | 'cancellation';
  newSessionDate: string | null;
  newStartTime: string | null;
  newEndTime: string | null;
  substituteTeacherId: string | null;
  substituteTeacherName: string | null;
  reason: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface SessionQueryParams {
  from: string;
  to: string;
  campusId?: string;
  courseId?: string;
  teacherId?: string;
}

@Injectable({ providedIn: 'root' })
export class SessionsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/sessions`;

  list(params: SessionQueryParams): Observable<{ data: Session[] }> {
    const query: Record<string, string> = { from: params.from, to: params.to };

    if (params.campusId) query['campusId'] = params.campusId;
    if (params.courseId) query['courseId'] = params.courseId;
    if (params.teacherId) query['teacherId'] = params.teacherId;

    return this.http.get<{ data: Session[] }>(this.endpoint, { params: query });
  }

  getChanges(sessionId: string): Observable<{ data: ScheduleChange[] }> {
    return this.http.get<{ data: ScheduleChange[] }>(`${this.endpoint}/${sessionId}/changes`);
  }

  cancel(sessionId: string, reason?: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.endpoint}/${sessionId}/cancel`, { reason });
  }

  substitute(
    sessionId: string,
    substituteTeacherId: string,
    reason?: string
  ): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.endpoint}/${sessionId}/substitute`, {
      substituteTeacherId,
      reason,
    });
  }

  reschedule(
    sessionId: string,
    newSessionDate: string,
    newStartTime: string,
    newEndTime: string,
    reason?: string
  ): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.endpoint}/${sessionId}/reschedule`, {
      newSessionDate,
      newStartTime,
      newEndTime,
      reason,
    });
  }
}
