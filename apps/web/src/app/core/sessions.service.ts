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
  attendanceTakenAt?: string | null;
  attendanceEnrolledCount?: number;
  attendancePresentCount?: number;
  attendanceOnLeaveCount?: number;
  attendanceAbsentCount?: number;
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

export interface ChangeLogEntry {
  id: string;
  sessionId: string;
  changeType:
    'reschedule' | 'substitute' | 'cancellation' | 'uncancel' | 'time_change' | 'creation';
  /** 後端組好的一句話，例如「代課：王小明 → 李老師」 */
  summary: string;
  sessionDate: string | null;
  className: string | null;
  reason: string | null;
  createdByName: string | null;
  createdAt: string;
  /** 批次操作會產生多筆，標記出來才不會看起來像有人重複操作 */
  isBatch: boolean;
}

export interface ChangeLogParams {
  from: string;
  to: string;
  changeType?: string;
  campusId?: string;
  page?: number;
  pageSize?: number;
}

export interface SubstitutedAwayEntry {
  changeId: string;
  sessionId: string;
  sessionDate: string | null;
  startTime: string | null;
  endTime: string | null;
  className: string | null;
  substituteTeacherName: string | null;
  reason: string | null;
  changedAt: string;
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
    meta: {
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
      monthUnassignedCount: number;
      todayPendingAttendanceCount: number;
    };
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
    if (params.statuses && params.statuses.length > 0)
      query['statuses'] = params.statuses.join(',');
    if (params.assignmentStatus) query['assignmentStatus'] = params.assignmentStatus;
    if (params.page) query['page'] = params.page.toString();
    if (params.pageSize) query['pageSize'] = params.pageSize.toString();

    return this.http.get<{
      data: Session[];
      meta: {
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
        monthUnassignedCount: number;
        todayPendingAttendanceCount: number;
      };
    }>(this.endpoint, { params: query });
  }

  /**
   * 某位老師原本排到、但後來被換掉的課堂。
   *
   * 代課時 sessions.teacher_id 已被改寫成代課老師，所以這些課堂用 list() 查不到 ——
   * 原老師保存在 schedule_changes.original_teacher_id。這些不計入時數，只是讓紀錄完整。
   */
  substitutedAway(params: {
    teacherId: string;
    from: string;
    to: string;
  }): Observable<{ data: SubstitutedAwayEntry[] }> {
    return this.http.get<{ data: SubstitutedAwayEntry[] }>(`${this.endpoint}/substituted-away`, {
      params: { teacherId: params.teacherId, from: params.from, to: params.to },
    });
  }

  /** 跨課堂的課務異動紀錄。依 created_at 由新到舊 —— 這是 log，關心「最近發生什麼」。 */
  listChanges(params: ChangeLogParams): Observable<{
    data: ChangeLogEntry[];
    meta: { total: number; page: number; pageSize: number };
  }> {
    const query: Record<string, string> = { from: params.from, to: params.to };
    if (params.changeType) query['changeType'] = params.changeType;
    if (params.campusId) query['campusId'] = params.campusId;
    if (params.page !== undefined) query['page'] = String(params.page);
    if (params.pageSize !== undefined) query['pageSize'] = String(params.pageSize);

    return this.http.get<{
      data: ChangeLogEntry[];
      meta: { total: number; page: number; pageSize: number };
    }>(`${this.endpoint}/changes`, { params: query });
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
