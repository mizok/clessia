import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type StaffRole = 'admin' | 'teacher';
export type StaffStatus = 'active' | 'inactive' | 'archived';

export type Permission =
  | 'basic_operations'
  | 'manage_courses'
  | 'manage_students'
  | 'manage_finance'
  | 'manage_staff'
  | 'manage_roles'
  | 'view_reports'
  | 'all_campuses';

export interface Staff {
  id: string;
  userId: string;
  orgId: string;
  displayName: string;
  phone: string | null;
  email: string;
  birthday: string | null;
  notes: string | null;
  subjectIds: string[];
  subjectNames: string[];
  status: StaffStatus;
  createdAt: string;
  updatedAt: string;
  campusIds: string[];
  roles: StaffRole[];
  permissions: Permission[];
}

export interface StaffListResponse {
  data: Staff[];
  summary: {
    total: number;
    adminCount: number;
    teacherCount: number;
    activeCount: number;
    inactiveCount: number;
    archivedCount: number;
  };
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface StaffQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: StaffRole;
  campusId?: string;
  subjectId?: string;
  status?: StaffStatus;
}

export interface CreateStaffInput {
  displayName: string;
  email: string;
  phone?: string | null;
  birthday?: string | null;
  notes?: string | null;
  subjectIds?: string[];
  campusIds: string[];
  roles: StaffRole[];
  permissions?: Permission[];
}

export interface UpdateStaffInput {
  displayName?: string;
  phone?: string | null;
  birthday?: string | null;
  notes?: string | null;
  subjectIds?: string[];
  campusIds?: string[];
  roles?: StaffRole[];
  status?: StaffStatus;
  permissions?: Permission[];
}

@Injectable({
  providedIn: 'root',
})
export class StaffService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;
  private readonly endpoint = `${this.baseUrl}/api/staff`;

  list(params?: StaffQueryParams): Observable<StaffListResponse> {
    return this.http.get<StaffListResponse>(this.endpoint, {
      params: this.toListParams(params),
    });
  }

  get(id: string): Observable<{ data: Staff }> {
    return this.http.get<{ data: Staff }>(`${this.endpoint}/${id}`);
  }

  create(input: CreateStaffInput): Observable<{ data: Staff; loginUrl: string | null }> {
    return this.http.post<{ data: Staff; loginUrl: string | null }>(this.endpoint, input);
  }

  /** 產生一次性登入連結。這個系統沒有密碼，員工靠它第一次進來並綁定 LINE。 */
  createLoginLink(userId: string): Observable<{ url: string; expiresInSeconds: number }> {
    return this.http.post<{ url: string; expiresInSeconds: number }>(
      `${environment.apiUrl}/api/login-links`,
      { userId },
    );
  }

  update(id: string, input: UpdateStaffInput): Observable<{ data: Staff }> {
    return this.http.put<{ data: Staff }>(`${this.endpoint}/${id}`, input);
  }

  archive(id: string): Observable<{ success: boolean; unassignedSessions: number }> {
    return this.http.patch<{ success: boolean; unassignedSessions: number }>(
      `${this.endpoint}/${id}/archive`,
      {},
    );
  }

  deactivate(id: string): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.endpoint}/${id}/deactivate`, {});
  }

  activate(id: string): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.endpoint}/${id}/activate`, {});
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.endpoint}/${id}`);
  }

  private toListParams(params?: StaffQueryParams): Record<string, string | number | boolean> {
    if (!params) {
      return {};
    }

    const query: Record<string, string | number | boolean> = {};

    if (params.page !== undefined) {
      query['page'] = params.page;
    }

    if (params.pageSize !== undefined) {
      query['pageSize'] = params.pageSize;
    }

    if (params.search !== undefined) {
      query['search'] = params.search;
    }

    if (params.role !== undefined) {
      query['role'] = params.role;
    }

    if (params.campusId !== undefined) {
      query['campusId'] = params.campusId;
    }

    if (params.subjectId !== undefined) {
      query['subjectId'] = params.subjectId;
    }

    if (params.status !== undefined) {
      query['status'] = params.status;
    }

    return query;
  }
}
