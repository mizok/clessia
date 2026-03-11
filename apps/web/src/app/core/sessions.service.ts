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

export interface SessionHistoryEntry {
  id: string;
  changeType: 'creation' | 'reschedule' | 'substitute' | 'cancellation' | 'uncancel';
  originalSessionDate: string | null;
  originalStartTime: string | null;
  originalEndTime: string | null;
  newSessionDate: string | null;
  newStartTime: string | null;
  newEndTime: string | null;
  originalTeacherId: string | null;
  originalTeacherName: string | null;
  substituteTeacherId: string | null;
  substituteTeacherName: string | null;
  operationSource: 'single' | 'batch' | null;
  reason: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface SessionQueryParams {
  from?: string;
  to?: string;
  campusIds?: string[];
  courseIds?: string[];
  teacherIds?: string[];
  classIds?: string[];
  classId?: string;
  statuses?: string[];
  assignmentStatus?: 'assigned' | 'unassigned';
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

  list(params: SessionQueryParams): Observable<{
    data: Session[];
    meta: { total: number; page: number; pageSize: number; totalPages: number; unassignedCount: number };
  }> {
    const query: Record<string, string> = {};

    if (params.from) query['from'] = params.from;
    if (params.to) query['to'] = params.to;
    if (params.campusIds && params.campusIds.length > 0) {
      query['campusIds'] = params.campusIds.join(',');
    }
    if (params.courseIds && params.courseIds.length > 0) {
      query['courseIds'] = params.courseIds.join(',');
    }
    if (params.teacherIds && params.teacherIds.length > 0) {
      query['teacherIds'] = params.teacherIds.join(',');
    }
    if (params.classIds && params.classIds.length > 0) {
      query['classIds'] = params.classIds.join(',');
    }
    if (params.classId) query['classId'] = params.classId;
    if (params.statuses && params.statuses.length > 0) query['statuses'] = params.statuses.join(',');
    if (params.assignmentStatus) query['assignmentStatus'] = params.assignmentStatus;
    if (params.page) query['page'] = params.page.toString();
    if (params.pageSize) query['pageSize'] = params.pageSize.toString();

    return this.http.get<{
      data: Session[];
      meta: { total: number; page: number; pageSize: number; totalPages: number; unassignedCount: number };
    }>(this.endpoint, { params: query });
  }

  getChanges(sessionId: string): Observable<{ data: SessionHistoryEntry[] }> {
    return this.http.get<{ data: SessionHistoryEntry[] }>(`${this.endpoint}/${sessionId}/changes`);
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
