import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type GradeLevel =
  | 'K'
  | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6'
  | 'J1' | 'J2' | 'J3'
  | 'S1' | 'S2' | 'S3';

export type StudentGender = 'male' | 'female' | 'prefer_not_to_say';

export interface Student {
  id: string;
  orgId: string;
  name: string;
  grade: GradeLevel;
  school: string;
  birthday: string | null;
  gender: StudentGender | null;
  phone: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  isActive: boolean;
  parentNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StudentDetailParent {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  relation: string | null;
  isPrimary: boolean;
}

export interface StudentDetail extends Student {
  parents: StudentDetailParent[];
}

export interface StudentListResponse {
  data: Student[];
  summary: { total: number; activeCount: number };
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface StudentQueryParams {
  search?: string;
  grade?: GradeLevel;
  page?: number;
  pageSize?: number;
  isActive?: boolean;
}

export interface UpdateStudentInput {
  name?: string;
  grade?: GradeLevel;
  school?: string;
  birthday?: string | null;
  gender?: StudentGender | null;
  phone?: string | null;
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export const GRADE_LEVELS: GradeLevel[] = [
  'K',
  'P1', 'P2', 'P3', 'P4', 'P5', 'P6',
  'J1', 'J2', 'J3',
  'S1', 'S2', 'S3',
];

export const GRADE_LEVEL_LABELS: Record<GradeLevel, string> = {
  K: '幼稚園',
  P1: '小一', P2: '小二', P3: '小三', P4: '小四', P5: '小五', P6: '小六',
  J1: '國一', J2: '國二', J3: '國三',
  S1: '高一', S2: '高二', S3: '高三',
};

@Injectable({ providedIn: 'root' })
export class StudentsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/students`;

  list(params?: StudentQueryParams): Observable<StudentListResponse> {
    return this.http.get<StudentListResponse>(this.endpoint, {
      params: this.toQueryParams(params),
    });
  }

  get(id: string): Observable<{ data: StudentDetail }> {
    return this.http.get<{ data: StudentDetail }>(`${this.endpoint}/${id}`);
  }

  update(id: string, input: UpdateStudentInput): Observable<{ data: Student }> {
    return this.http.put<{ data: Student }>(`${this.endpoint}/${id}`, input);
  }

  deactivate(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.endpoint}/${id}`);
  }

  private toQueryParams(params?: StudentQueryParams): Record<string, string | number | boolean> {
    if (!params) return {};
    const q: Record<string, string | number | boolean> = {};
    if (params.search !== undefined) q['search'] = params.search;
    if (params.grade !== undefined) q['grade'] = params.grade;
    if (params.page !== undefined) q['page'] = params.page;
    if (params.pageSize !== undefined) q['pageSize'] = params.pageSize;
    if (params.isActive !== undefined) q['isActive'] = params.isActive;
    return q;
  }
}
