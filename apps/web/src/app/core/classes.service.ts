import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export interface Schedule {
  id: string;
  classId: string;
  weekday: number; // 1=Monday, 7=Sunday
  startTime: string; // HH:mm:ss
  endTime: string;
  teacherId: string | null;
  teacherName?: string;
  effectiveTo: string | null;
}

export interface Class {
  id: string;
  orgId: string;
  campusId: string;
  courseId: string;
  courseName?: string;
  campusName?: string;
  name: string;
  maxStudents: number;
  gradeLevels: string[];
  nextClassId: string | null;
  isActive: boolean;
  scheduleCount?: number;
  scheduleTeacherIds?: string[];
  hasUpcomingSessions?: boolean;
  hasAnySessions?: boolean;
  // TODO: 待老師點名功能完成後，改為依據 status='completed' 判斷
  hasPastSessions?: boolean;
  upcomingCancelledCount?: number;
  upcomingUnassignedCount?: number;
  upcomingClassConflictCount?: number;
  upcomingTeacherConflictCount?: number;
  schedules?: Schedule[];
  createdAt: string;
  updatedAt: string;
  updatedBy?: string | null;
  updatedByName?: string | null;
}

export interface ClassListResponse {
  data: Class[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface ClassQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  campusId?: string;
  courseId?: string;
  isActive?: boolean;
}

export interface CreateClassInput {
  courseId: string;
  name: string;
  maxStudents?: number;
  gradeLevels?: string[];
  nextClassId?: string | null;
}

export interface UpdateClassInput {
  name?: string;
  maxStudents?: number;
  gradeLevels?: string[];
  nextClassId?: string | null;
  isActive?: boolean;
}

export interface CreateScheduleInput {
  weekday: number;
  startTime: string;
  endTime: string;
  teacherId: string | null;
  effectiveTo?: string | null;
}

export interface SessionPreview {
  sessionDate: string;
  startTime: string;
  endTime: string;
  teacherId: string | null;
  teacherName?: string;
  weekday: number;
  exists: boolean;
}

export interface CheckConflictScheduleInput {
  weekday: number;
  startTime: string;
  endTime: string;
  teacherId: string | null;
  effectiveTo?: string | null;
}

export interface ScheduleConflict {
  scheduleIndex: number;
  teacherName: string;
  conflictingClassId: string;
  conflictingClassName: string;
  conflictingCourseName: string;
  conflictingWeekday: number;
  conflictingStartTime: string;
  conflictingEndTime: string;
}

export interface BatchAssignTimeRangeInput {
  startTime: string;
  endTime: string;
}

export type BatchAssignMode = 'skip-conflicts' | 'strict' | 'force';

export interface BatchAssignTeacherInput {
  from: string;
  to: string;
  toTeacherId: string;
  weekday?: number[];
  timeRanges?: BatchAssignTimeRangeInput[];
  mode?: BatchAssignMode;
  includeAssigned?: boolean;
  dryRun?: boolean;
}

export interface BatchAssignConflict {
  sessionId: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  conflictWithSessionId: string;
}

export interface BatchAssignTeacherResult {
  updated: number;
  skippedConflicts: number;
  skippedNotEligible: number;
  conflicts: BatchAssignConflict[];
  dryRun: boolean;
}

export type BatchSessionConflictReason =
  | 'status_not_editable'
  | 'status_not_cancellable'
  | 'status_not_reopenable'
  | 'class_conflict'
  | 'teacher_conflict';

export interface BatchSessionConflict {
  sessionId: string;
  sessionDate: string;
  reason: BatchSessionConflictReason;
  detail: string;
  conflictingSessionId?: string;
}

export interface BatchSessionActionResult {
  updated: number;
  skipped: number;
  processableIds: string[];
  conflicts: BatchSessionConflict[];
  dryRun: boolean;
}

export interface BatchUpdateSessionTimeInput {
  sessionIds: string[];
  startTime: string;
  endTime: string;
  dryRun?: boolean;
}

export interface BatchCancelSessionsInput {
  sessionIds: string[];
  dryRun?: boolean;
}

export interface GenerateSessionsResult {
  createdAssigned: number;
  createdUnassigned: number;
  skippedExisting: number;
  skippedNoTeacher: number;
  totalPlanned: number;
}

@Injectable({ providedIn: 'root' })
export class ClassesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;
  private readonly endpoint = `${this.baseUrl}/api/classes`;

  list(params?: ClassQueryParams): Observable<ClassListResponse> {
    return this.http.get<ClassListResponse>(this.endpoint, {
      params: this.toListParams(params),
    });
  }

  get(id: string): Observable<{ data: Class }> {
    return this.http.get<{ data: Class }>(`${this.endpoint}/${id}`);
  }

  create(input: CreateClassInput): Observable<{ data: Class }> {
    return this.http.post<{ data: Class }>(this.endpoint, input);
  }

  update(id: string, input: UpdateClassInput): Observable<{ data: Class }> {
    return this.http.put<{ data: Class }>(`${this.endpoint}/${id}`, input);
  }

  toggleActive(id: string): Observable<{ data: Class }> {
    return this.http.patch<{ data: Class }>(`${this.endpoint}/${id}/toggle-active`, {});
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.endpoint}/${id}`);
  }

  addSchedule(classId: string, input: CreateScheduleInput): Observable<{ data: Schedule }> {
    return this.http.post<{ data: Schedule }>(`${this.endpoint}/${classId}/schedules`, input);
  }

  updateSchedule(
    classId: string,
    scheduleId: string,
    input: Partial<CreateScheduleInput>,
  ): Observable<{ data: Schedule }> {
    return this.http.put<{ data: Schedule }>(
      `${this.endpoint}/${classId}/schedules/${scheduleId}`,
      input,
    );
  }

  deleteSchedule(classId: string, scheduleId: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(
      `${this.endpoint}/${classId}/schedules/${scheduleId}`,
    );
  }

  previewSessions(
    classId: string,
    from: string,
    to: string,
    excludeDates?: string[],
  ): Observable<{ data: SessionPreview[] }> {
    const params: Record<string, string> = { from, to };
    if (excludeDates && excludeDates.length > 0) {
      params['excludeDates'] = excludeDates.join(',');
    }
    return this.http.get<{ data: SessionPreview[] }>(
      `${this.endpoint}/${classId}/sessions/preview`,
      { params },
    );
  }

  generateSessions(
    classId: string,
    from: string,
    to: string,
    excludeDates?: string[],
  ): Observable<GenerateSessionsResult> {
    return this.http.post<GenerateSessionsResult>(`${this.endpoint}/${classId}/sessions/generate`, {
      from,
      to,
      ...(excludeDates && excludeDates.length > 0 ? { excludeDates } : {}),
    });
  }

  checkScheduleConflicts(
    schedules: CheckConflictScheduleInput[],
    excludeClassId?: string,
  ): Observable<{ conflicts: ScheduleConflict[] }> {
    return this.http.post<{ conflicts: ScheduleConflict[] }>(`${this.endpoint}/check-conflicts`, {
      schedules,
      ...(excludeClassId ? { excludeClassId } : {}),
    });
  }

  batchAssignTeacher(
    classId: string,
    input: BatchAssignTeacherInput,
  ): Observable<BatchAssignTeacherResult> {
    return this.http.patch<BatchAssignTeacherResult>(
      `${this.endpoint}/${classId}/sessions/batch-assign-teacher`,
      input,
    );
  }

  batchUpdateSessionTime(
    classId: string,
    input: BatchUpdateSessionTimeInput,
  ): Observable<BatchSessionActionResult> {
    return this.http.patch<BatchSessionActionResult>(
      `${this.endpoint}/${classId}/sessions/batch-update-time`,
      input,
    );
  }

  batchCancelSessions(
    classId: string,
    input: BatchCancelSessionsInput,
  ): Observable<BatchSessionActionResult> {
    return this.http.patch<BatchSessionActionResult>(
      `${this.endpoint}/${classId}/sessions/batch-cancel`,
      input,
    );
  }

  batchUncancelSessions(
    classId: string,
    input: BatchCancelSessionsInput,
  ): Observable<BatchSessionActionResult> {
    return this.http.patch<BatchSessionActionResult>(
      `${this.endpoint}/${classId}/sessions/batch-uncancel`,
      input,
    );
  }

  batchSetActive(ids: string[], isActive: boolean): Observable<{ updated: number }> {
    return this.http.patch<{ updated: number }>(`${this.endpoint}/batch-set-active`, {
      ids,
      isActive,
    });
  }

  batchDelete(
    ids: string[],
  ): Observable<{ deleted: number; deletedIds: string[]; skipped: number }> {
    return this.http.delete<{ deleted: number; deletedIds: string[]; skipped: number }>(
      `${this.endpoint}/batch`,
      { body: { ids } },
    );
  }

  cancelFutureSessions(id: string): Observable<{ cancelled: number }> {
    return this.http.post<{ cancelled: number }>(
      `${this.endpoint}/${id}/cancel-future-sessions`,
      {},
    );
  }

  private toListParams(params?: ClassQueryParams): Record<string, string | number | boolean> {
    if (!params) return {};

    const query: Record<string, string | number | boolean> = {};
    if (params.page !== undefined) query['page'] = params.page;
    if (params.pageSize !== undefined) query['pageSize'] = params.pageSize;
    if (params.search !== undefined) query['search'] = params.search;
    if (params.campusId !== undefined) query['campusId'] = params.campusId;
    if (params.courseId !== undefined) query['courseId'] = params.courseId;
    if (params.isActive !== undefined) query['isActive'] = params.isActive;

    return query;
  }
}
