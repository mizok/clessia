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
  studentNames: string[]; // 關聯學生姓名列表
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
  notes?: string;
}

export interface UpdateParentInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export interface BatchImportRow {
  parentName: string;
  parentPhone?: string;
  parentEmail?: string;
  parentNotes?: string;
  studentName: string;
  studentGrade: string; // 'P1'|'P2'|...|'S3'
  studentSchool: string;
  studentBirthday?: string;
  studentGender?: string;
}

export interface BatchImportResultItem {
  rowIndex: number;
  status: 'success' | 'failed';
  parentId?: string;
  studentId?: string;
  error?: string;
}

export interface BatchImportResponse {
  parentsCreated: number;
  studentsCreated: number;
  results: BatchImportResultItem[];
}

export interface BatchCheckRow {
  parentName: string;
  parentPhone?: string;
  parentEmail?: string;
  studentName?: string; // optional; absent means skip student duplicate check
}

export interface BatchCheckWarning {
  rowIndex: number; // 0-based, maps to parsedRows array index
  type: 'same_name_exists' | 'student_already_exists' | 'merging_with_existing';
  message: string;
}

export interface BatchCheckError {
  rowIndex: number; // 0-based array index
  type: 'student_already_exists' | 'contact_belongs_to_another_parent';
  message: string;
}

export interface BatchCheckResponse {
  warnings: BatchCheckWarning[];
  errors: BatchCheckError[];
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

  create(input: CreateParentInput): Observable<{ data: Parent; loginUrl: string | null }> {
    return this.http.post<{ data: Parent; loginUrl: string | null }>(this.endpoint, input);
  }

  update(id: string, input: UpdateParentInput): Observable<{ data: Parent }> {
    return this.http.put<{ data: Parent }>(`${this.endpoint}/${id}`, input);
  }

  /** 產生一次性登入連結。取代原本的重設密碼 —— 這個系統沒有密碼了。 */
  createLoginLink(userId: string): Observable<{ url: string; expiresInSeconds: number }> {
    return this.http.post<{ url: string; expiresInSeconds: number }>(
      `${environment.apiUrl}/api/login-links`,
      { userId },
    );
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

  batchImport(rows: BatchImportRow[]): Observable<BatchImportResponse> {
    return this.http.post<BatchImportResponse>(`${this.endpoint}/batch-import`, { rows });
  }

  batchCheck(rows: BatchCheckRow[]): Observable<BatchCheckResponse> {
    return this.http.post<BatchCheckResponse>(`${this.endpoint}/batch-check`, { rows });
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
