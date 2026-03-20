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
  courseId: string;
  courseName: string;
  studentId: string;
  studentName: string;
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

export interface CreateEnrollmentInput {
  classId: string;
  studentId: string;
  status?: 'pending_payment' | 'active';
  paymentCycle?: PaymentCycle;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  notes?: string;
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
  status?: EnrollmentStatus;
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
}

@Injectable({ providedIn: 'root' })
export class EnrollmentsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/enrollments`;

  list(params: EnrollmentQueryParams = {}): Observable<EnrollmentListResponse> {
    const query = new URLSearchParams();
    if (params.classId) query.set('classId', params.classId);
    if (params.studentId) query.set('studentId', params.studentId);
    if (params.status) query.set('status', params.status);
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    return this.http.get<EnrollmentListResponse>(`${this.base}?${query}`);
  }

  create(input: CreateEnrollmentInput): Observable<{ data: Enrollment }> {
    return this.http.post<{ data: Enrollment }>(this.base, input);
  }

  batchCreate(input: BatchCreateInput): Observable<{ results: BatchCreateResultItem[] }> {
    return this.http.post<{ results: BatchCreateResultItem[] }>(`${this.base}/batch`, input);
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
}
