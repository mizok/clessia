import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type ParentStatus = 'active' | 'inactive' | 'archived';

export interface Parent {
  id: string;
  userId: string; // ba_user.id（text，非 uuid 格式）
  orgId: string;
  name: string;
  phone: string | null;
  email: string | null;
  loginAccount: string; // email 優先，否則 phone
  status: ParentStatus;
  studentCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ParentDetailStudent {
  id: string;
  name: string;
  grade: string;
  relation: string | null;
  isPrimary: boolean;
}

export interface ParentDetail extends Parent {
  students: ParentDetailStudent[];
}

export interface ParentListResponse {
  data: Parent[];
  summary: {
    total: number;
    activeCount: number;
    inactiveCount: number;
    archivedCount: number;
  };
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface ParentQueryParams {
  search?: string;
  status?: ParentStatus;
  page?: number;
  pageSize?: number;
}

export interface CreateParentInput {
  name: string;
  email?: string;
  phone?: string;
  studentIds?: string[];
  notes?: string;
}

export interface UpdateParentInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  studentIds?: string[]; // 全量替換；[] 表示解除所有關聯
  notes?: string | null;
}

export const PARENT_STATUS_LABELS: Record<ParentStatus, string> = {
  active: '啟用',
  inactive: '停用',
  archived: '封存',
};

@Injectable({ providedIn: 'root' })
export class ParentsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/parents`;

  list(params?: ParentQueryParams): Observable<ParentListResponse> {
    return this.http.get<ParentListResponse>(this.endpoint, {
      params: this.toQueryParams(params),
    });
  }

  get(id: string): Observable<{ data: ParentDetail }> {
    return this.http.get<{ data: ParentDetail }>(`${this.endpoint}/${id}`);
  }

  create(input: CreateParentInput): Observable<{ data: Parent; initialPassword: string }> {
    return this.http.post<{ data: Parent; initialPassword: string }>(this.endpoint, input);
  }

  update(id: string, input: UpdateParentInput): Observable<{ data: Parent }> {
    return this.http.put<{ data: Parent }>(`${this.endpoint}/${id}`, input);
  }

  resetPassword(id: string): Observable<{ password: string }> {
    return this.http.post<{ password: string }>(`${this.endpoint}/${id}/reset-password`, {});
  }

  activate(id: string): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.endpoint}/${id}/activate`, {});
  }

  deactivate(id: string): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.endpoint}/${id}/deactivate`, {});
  }

  archive(id: string): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.endpoint}/${id}/archive`, {});
  }

  private toQueryParams(params?: ParentQueryParams): Record<string, string | number> {
    if (!params) return {};
    const q: Record<string, string | number> = {};
    if (params.search !== undefined) q['search'] = params.search;
    if (params.status !== undefined) q['status'] = params.status;
    if (params.page !== undefined) q['page'] = params.page;
    if (params.pageSize !== undefined) q['pageSize'] = params.pageSize;
    return q;
  }
}
