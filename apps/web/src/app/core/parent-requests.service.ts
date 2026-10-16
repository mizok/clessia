import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '@env/environment';

/** 頁面分組 → 伺服器把報名、試聽兩套狀態對到同一組（#1707） */
export type ParentRequestGroup = 'pending' | 'active' | 'done' | 'rejected' | 'cancelled';
export type TrialRequestStatus = 'pending' | 'scheduled' | 'completed' | 'cancelled';

/** 家長登入後在 app 送的報名／試聽申請（`/api/parent-requests`） */
export interface ParentRequest {
  id: string;
  kind: 'enrollment' | 'trial';
  /** 報名：pending／waitlist／awaiting_payment／completed／rejected／cancelled／expired；試聽見 TrialRequestStatus */
  status: string;
  createdAt: string;
  student: { id: string; name: string };
  parent: { name: string | null; phone: string | null };
  target: { name: string; campusName: string | null };
  preferredStartDate: string | null;
  preferredTimes: string | null;
  note: string | null;
  rejectReason: string | null;
}

@Injectable({ providedIn: 'root' })
export class ParentRequestsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/parent-requests`;

  list(params: {
    group: ParentRequestGroup;
    kind?: 'enrollment' | 'trial' | null;
  }): Observable<{ data: ParentRequest[] }> {
    const query: Record<string, string> = { group: params.group };
    if (params.kind) query['kind'] = params.kind;
    return this.http.get<{ data: ParentRequest[] }>(this.endpoint, { params: query });
  }

  /** 報名只能拒絕（原因家長看得到）；核准另開 #1726 */
  reject(id: string, rejectReason: string): Observable<{ data: ParentRequest }> {
    return this.http.patch<{ data: ParentRequest }>(`${this.endpoint}/enrollment/${id}`, {
      status: 'rejected',
      rejectReason,
    });
  }

  setTrialStatus(id: string, status: TrialRequestStatus): Observable<{ data: ParentRequest }> {
    return this.http.patch<{ data: ParentRequest }>(`${this.endpoint}/trial/${id}`, { status });
  }
}
