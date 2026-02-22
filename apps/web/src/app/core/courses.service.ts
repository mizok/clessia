import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export interface Course {
  id: string;
  orgId: string;
  campusId: string;
  campusName?: string;
  name: string;
  subjectId: string;
  subjectName: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CourseListResponse {
  data: Course[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface CourseQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  campusId?: string;
  subjectId?: string;
  isActive?: boolean;
}

export interface CreateCourseInput {
  campusId: string;
  name: string;
  subjectId: string;
  description?: string | null;
}

export interface UpdateCourseInput {
  name?: string;
  subjectId?: string;
  description?: string | null;
  isActive?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class CoursesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;
  private readonly endpoint = `${this.baseUrl}/api/courses`;

  list(params?: CourseQueryParams): Observable<CourseListResponse> {
    return this.http.get<CourseListResponse>(this.endpoint, {
      params: this.toListParams(params),
    });
  }

  get(id: string): Observable<{ data: Course }> {
    return this.http.get<{ data: Course }>(`${this.endpoint}/${id}`);
  }

  create(input: CreateCourseInput): Observable<{ data: Course }> {
    return this.http.post<{ data: Course }>(this.endpoint, input);
  }

  update(id: string, input: UpdateCourseInput): Observable<{ data: Course }> {
    return this.http.put<{ data: Course }>(`${this.endpoint}/${id}`, input);
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.endpoint}/${id}`);
  }

  private toListParams(params?: CourseQueryParams): Record<string, string | number | boolean> {
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

    if (params.campusId !== undefined) {
      query['campusId'] = params.campusId;
    }

    if (params.subjectId !== undefined) {
      query['subjectId'] = params.subjectId;
    }

    if (params.isActive !== undefined) {
      query['isActive'] = params.isActive;
    }

    return query;
  }
}
