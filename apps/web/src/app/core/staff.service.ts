import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type StaffRole = 'admin' | 'teacher';

export type Permission =
  | 'basic_operations'
  | 'manage_courses'
  | 'manage_students'
  | 'manage_finance'
  | 'manage_staff'
  | 'view_reports';

export interface Staff {
  id: string;
  userId: string;
  orgId: string;
  displayName: string;
  phone: string | null;
  email: string;
  birthday: string | null;
  notes: string | null;
  subjects: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  campusIds: string[];
  roles: StaffRole[];
  permissions: Permission[];
}

export interface StaffListResponse {
  data: Staff[];
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
  isActive?: boolean;
}

export interface CreateStaffInput {
  displayName: string;
  email: string;
  phone?: string | null;
  birthday?: string | null;
  notes?: string | null;
  subjects?: string[];
  campusIds: string[];
  roles: StaffRole[];
  permissions?: Permission[];
}

export interface UpdateStaffInput {
  displayName?: string;
  phone?: string | null;
  birthday?: string | null;
  notes?: string | null;
  subjects?: string[];
  campusIds?: string[];
  roles?: StaffRole[];
  isActive?: boolean;
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

  create(input: CreateStaffInput): Observable<{ data: Staff }> {
    return this.http.post<{ data: Staff }>(this.endpoint, input);
  }

  update(id: string, input: UpdateStaffInput): Observable<{ data: Staff }> {
    return this.http.put<{ data: Staff }>(`${this.endpoint}/${id}`, input);
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

    if (params.isActive !== undefined) {
      query['isActive'] = params.isActive;
    }

    return query;
  }
}
