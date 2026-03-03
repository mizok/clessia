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
  assignmentStatus: 'assigned' | 'unassigned';
  classId: string;
  className: string;
  courseId: string;
  courseName: string;
  campusId: string;
  campusName: string;
  teacherId: string | null;
  teacherName: string | null;
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
  from?: string;
  to?: string;
  campusId?: string;
  courseId?: string;
  teacherId?: string;
  classId?: string;
  page?: number;
  pageSize?: number;
}

// ── Batch operation types ──────────────────────────────────────

export interface BatchAssignInput {
  readonly sessionIds: string[];
  readonly teacherId: string;
  readonly includeAssigned?: boolean;
  readonly dryRun?: boolean;
}

export interface BatchAssignConflict {
  readonly sessionId: string;
  readonly sessionDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly conflictWithSessionId: string;
}

export interface BatchAssignResult {
  readonly updated: number;
  readonly skippedConflicts: number;
  readonly skippedNotEligible: number;
  readonly conflicts: readonly BatchAssignConflict[];
  readonly dryRun: boolean;
}

export interface BatchTimeInput {
  readonly sessionIds: string[];
  readonly startTime: string;
  readonly endTime: string;
  readonly dryRun?: boolean;
}

export interface BatchCancelInput {
  readonly sessionIds: string[];
  readonly reason?: string;
  readonly dryRun?: boolean;
}

export interface BatchSessionConflict {
  readonly sessionId: string;
  readonly sessionDate: string;
  readonly reason: string;
  readonly detail: string;
  readonly conflictingSessionId?: string;
}

export interface BatchActionResult {
  readonly updated: number;
  readonly skipped: number;
  readonly processableIds: readonly string[];
  readonly conflicts: readonly BatchSessionConflict[];
  readonly dryRun: boolean;
}

@Injectable({ providedIn: 'root' })
export class SessionsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/sessions`;

  list(params: SessionQueryParams): Observable<{ data: Session[] }> {
    const query: Record<string, string> = {};

    if (params.from) query['from'] = params.from;
    if (params.to) query['to'] = params.to;
    if (params.campusId) query['campusId'] = params.campusId;
    if (params.courseId) query['courseId'] = params.courseId;
    if (params.teacherId) query['teacherId'] = params.teacherId;
    if (params.classId) query['classId'] = params.classId;
    if (params.page) query['page'] = params.page.toString();
    if (params.pageSize) query['pageSize'] = params.pageSize.toString();

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
    reason?: string,
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
    reason?: string,
  ): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.endpoint}/${sessionId}/reschedule`, {
      newSessionDate,
      newStartTime,
      newEndTime,
      reason,
    });
  }

  // ── Batch operations ───────────────────────────────────────────

  batchAssignTeacher(input: BatchAssignInput): Observable<BatchAssignResult> {
    return this.http.patch<BatchAssignResult>(`${this.endpoint}/batch-assign-teacher`, input);
  }

  batchUpdateTime(input: BatchTimeInput): Observable<BatchActionResult> {
    return this.http.patch<BatchActionResult>(`${this.endpoint}/batch-update-time`, input);
  }

  batchCancel(input: BatchCancelInput): Observable<BatchActionResult> {
    return this.http.patch<BatchActionResult>(`${this.endpoint}/batch-cancel`, input);
  }

  batchUncancel(input: { sessionIds: string[]; dryRun?: boolean }): Observable<BatchActionResult> {
    return this.http.patch<BatchActionResult>(`${this.endpoint}/batch-uncancel`, input);
  }
}
