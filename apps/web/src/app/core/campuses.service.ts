import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export interface Campus {
  id: string;
  orgId: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CampusListResponse {
  data: Campus[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface CampusQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  isActive?: boolean;
}

export interface CreateCampusInput {
  name: string;
  address?: string | null;
  phone?: string | null;
}

export interface UpdateCampusInput {
  name?: string;
  address?: string | null;
  phone?: string | null;
  isActive?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class CampusesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;
  private readonly endpoint = `${this.baseUrl}/api/campuses`;

  list(params?: CampusQueryParams): Observable<CampusListResponse> {
    return this.http.get<CampusListResponse>(this.endpoint, {
      params: this.toListParams(params),
    });
  }

  get(id: string): Observable<{ data: Campus }> {
    return this.http.get<{ data: Campus }>(`${this.endpoint}/${id}`);
  }

  create(input: CreateCampusInput): Observable<{ data: Campus }> {
    return this.http.post<{ data: Campus }>(this.endpoint, input);
  }

  update(id: string, input: UpdateCampusInput): Observable<{ data: Campus }> {
    return this.http.put<{ data: Campus }>(`${this.endpoint}/${id}`, input);
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.endpoint}/${id}`);
  }

  private toListParams(params?: CampusQueryParams): Record<string, string | number | boolean> {
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

    if (params.isActive !== undefined) {
      query['isActive'] = params.isActive;
    }

    return query;
  }
}
