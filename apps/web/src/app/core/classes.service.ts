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
  teacherId: string;
  teacherName?: string;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null;
}

export interface Class {
  id: string;
  orgId: string;
  campusId: string;
  courseId: string;
  courseName?: string;
  name: string;
  maxStudents: number;
  gradeLevels: string[];
  isRecommended: boolean;
  nextClassId: string | null;
  isActive: boolean;
  schedules?: Schedule[];
  createdAt: string;
  updatedAt: string;
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
  isRecommended?: boolean;
  nextClassId?: string | null;
}

export interface UpdateClassInput {
  name?: string;
  maxStudents?: number;
  gradeLevels?: string[];
  isRecommended?: boolean;
  nextClassId?: string | null;
  isActive?: boolean;
}

export interface CreateScheduleInput {
  weekday: number;
  startTime: string;
  endTime: string;
  teacherId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface SessionPreview {
  sessionDate: string;
  startTime: string;
  endTime: string;
  teacherId: string;
  teacherName?: string;
  weekday: number;
  exists: boolean;
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
    input: Partial<CreateScheduleInput>
  ): Observable<{ data: Schedule }> {
    return this.http.put<{ data: Schedule }>(
      `${this.endpoint}/${classId}/schedules/${scheduleId}`,
      input
    );
  }

  deleteSchedule(classId: string, scheduleId: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(
      `${this.endpoint}/${classId}/schedules/${scheduleId}`
    );
  }

  previewSessions(
    classId: string,
    from: string,
    to: string
  ): Observable<{ data: SessionPreview[] }> {
    return this.http.get<{ data: SessionPreview[] }>(
      `${this.endpoint}/${classId}/sessions/preview`,
      { params: { from, to } }
    );
  }

  generateSessions(
    classId: string,
    from: string,
    to: string
  ): Observable<{ created: number; skipped: number }> {
    return this.http.post<{ created: number; skipped: number }>(
      `${this.endpoint}/${classId}/sessions/generate`,
      { from, to }
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
