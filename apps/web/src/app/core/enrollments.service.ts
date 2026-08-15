import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type EnrollmentStatus = 'pending_payment' | 'active' | 'suspended' | 'withdrawal' | 'void';
export type PaymentCycle = 'monthly' | 'semester';

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  pending_payment: '待付款',
  active: '在籍',
  suspended: '暫停',
  withdrawal: '退班',
  void: '失效',
};

export interface Enrollment {
  id: string;
  orgId: string;
  classId: string;
  className: string;
  campusId: string | null;
  campusName: string | null;
  courseId: string;
  courseName: string;
  studentId: string;
  studentName: string;
  studentSchool: string;
  studentGrade: string;
  status: EnrollmentStatus;
  paymentCycle: PaymentCycle | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  attendanceCount: number;
}

export interface ScheduleConflictWarning {
  studentId: string;
  conflictingClassId: string;
  conflictingClassName: string;
  conflictingCourseName: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface CreateEnrollmentInput {
  classId: string;
  studentId: string;
  status?: 'pending_payment' | 'active';
  paymentCycle?: PaymentCycle;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  notes?: string;
  skipConflictCheck?: boolean;
}

export interface UpdateEnrollmentInput {
  paymentCycle?: PaymentCycle | null;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  notes?: string | null;
}

export interface EnrollmentListResponse {
  data: Enrollment[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface EnrollmentQueryParams {
  classId?: string;
  studentId?: string;
  campusId?: string;
  status?: EnrollmentStatus;
  /** 期間內「發生過事情」：這段期間開始生效（新報名）或結束（退班） */
  from?: string;
  to?: string;
  /** 預設 createdAt；進出總覽用 updatedAt，見 list-query.ts */
  sort?: 'createdAt' | 'updatedAt';
  page?: number;
  pageSize?: number;
}

export interface BatchCreateResultItem {
  studentId: string;
  status: 'enrolled' | 'already_exists' | 'error';
  enrollmentId?: string;
  message?: string;
}

export interface BatchCreateInput {
  classId: string;
  studentIds: string[];
  skipConflictCheck?: boolean;
}

export interface BatchCreateResult {
  results: BatchCreateResultItem[];
  warnings?: ScheduleConflictWarning[];
}

export interface CreateEnrollmentResponse {
  data: Enrollment;
  warnings?: ScheduleConflictWarning[];
}

export interface CopyFromClassInput {
  targetClassId: string;
  sourceClassId: string;
  statuses: EnrollmentStatus[];
}

export interface CopyFromClassResult {
  copied: number;
  skipped: number;
}

export interface BatchMatchItem {
  name: string;
  school: string;
}

export interface BatchMatchCandidate {
  id: string;
  name: string;
  grade: string;
  school: string;
  birthday?: string | null;
}

export interface BatchMatchResultItem {
  index: number;
  status: 'matched' | 'ambiguous' | 'not_found' | 'already_enrolled';
  studentId?: string;
  candidates?: BatchMatchCandidate[];
}

export interface BatchMatchResponse {
  results: BatchMatchResultItem[];
}

@Injectable({ providedIn: 'root' })
export class EnrollmentsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/enrollments`;

  list(params: EnrollmentQueryParams = {}): Observable<EnrollmentListResponse> {
    const query = new URLSearchParams();
    if (params.classId) query.set('classId', params.classId);
    if (params.studentId) query.set('studentId', params.studentId);
    if (params.campusId) query.set('campusId', params.campusId);
    if (params.status) query.set('status', params.status);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    if (params.sort) query.set('sort', params.sort);
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    return this.http.get<EnrollmentListResponse>(`${this.base}?${query}`);
  }

  create(input: CreateEnrollmentInput): Observable<CreateEnrollmentResponse> {
    return this.http.post<CreateEnrollmentResponse>(this.base, input);
  }

  batchCreate(input: BatchCreateInput): Observable<BatchCreateResult> {
    return this.http.post<BatchCreateResult>(`${this.base}/batch`, input);
  }

  update(id: string, input: UpdateEnrollmentInput): Observable<{ data: Enrollment }> {
    return this.http.patch<{ data: Enrollment }>(`${this.base}/${id}`, input);
  }

  updateStatus(id: string, status: EnrollmentStatus, notes?: string): Observable<{ data: Enrollment }> {
    return this.http.patch<{ data: Enrollment }>(`${this.base}/${id}/status`, { status, notes });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  batchMatch(classId: string, items: BatchMatchItem[]): Observable<BatchMatchResponse> {
    return this.http.post<BatchMatchResponse>(`${this.base}/batch-match`, { classId, items });
  }

  copyFromClass(input: CopyFromClassInput): Observable<CopyFromClassResult> {
    return this.http.post<CopyFromClassResult>(`${this.base}/copy-from-class`, input);
  }
}
