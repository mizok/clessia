import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

export interface AuditLog {
  id: string;
  userId: string | null;
  userName: string | null;
  resourceType: string;
  resourceId: string | null;
  resourceName: string | null;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogListResponse {
  data: AuditLog[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

@Injectable({ providedIn: 'root' })
export class AuditLogsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/audit-logs`;

  list(params: {
    resourceTypes?: string[];
    page?: number;
    pageSize?: number;
  }): Observable<AuditLogListResponse> {
    const queryParams: Record<string, string> = {};
    if (params.resourceTypes && params.resourceTypes.length > 0) {
      queryParams['resourceTypes'] = params.resourceTypes.join(',');
    }
    if (params.page !== undefined) {
      queryParams['page'] = String(params.page);
    }
    if (params.pageSize !== undefined) {
      queryParams['pageSize'] = String(params.pageSize);
    }
    return this.http.get<AuditLogListResponse>(this.endpoint, { params: queryParams });
  }
}
