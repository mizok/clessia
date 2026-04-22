import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '@env/environment';

export interface School {
  readonly id: string;
  readonly name: string;
  readonly shortName: string | null;
  readonly isActive: boolean;
  readonly studentCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SchoolListResponse {
  readonly data: School[];
  readonly meta: { total: number };
}

export interface CreateSchoolInput {
  readonly name: string;
  readonly shortName?: string | null;
  readonly isActive?: boolean;
}

export interface UpdateSchoolInput {
  readonly name?: string;
  readonly shortName?: string | null;
  readonly isActive?: boolean;
}

@Injectable({ providedIn: 'root' })
export class SchoolsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/schools`;

  private readonly _cache = signal<School[]>([]);
  readonly cache = this._cache.asReadonly();

  list(params: { search?: string; isActive?: boolean } = {}): Observable<SchoolListResponse> {
    const q: Record<string, string> = {};
    if (params.search) q['search'] = params.search;
    if (params.isActive !== undefined) q['isActive'] = String(params.isActive);
    return this.http
      .get<SchoolListResponse>(this.base, { params: q })
      .pipe(tap((res) => this._cache.set(res.data)));
  }

  create(input: CreateSchoolInput): Observable<{ data: School }> {
    return this.http.post<{ data: School }>(this.base, input);
  }

  update(id: string, input: UpdateSchoolInput): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.base}/${id}`, input);
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/${id}`);
  }
}
