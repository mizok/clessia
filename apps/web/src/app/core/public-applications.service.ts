import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '@env/environment';
import type { GradeLevel } from './students.service';

/** 公開表單送進來的申請的聯絡狀態（#1245）。不是報名狀態機 —— 任意切換 */
export type PublicApplicationStatus = 'new' | 'contacted' | 'converted' | 'rejected' | 'spam';

export interface PublicApplication {
  id: string;
  kind: 'enrollment' | 'trial';
  status: PublicApplicationStatus;
  createdAt: string;
  parent: {
    name: string;
    email: string | null;
    phone: string | null;
    relation: 'father' | 'mother' | 'other';
  };
  student: { name: string; grade: GradeLevel; school: string };
  preferredStartDate: string | null;
  preferredTimes: string | null;
  note: string | null;
  staffNote: string | null;
  targets: Array<{
    type: 'class' | 'course';
    /** 班或課程被刪了 → null，`deleted: true` */
    name: string | null;
    campusName: string | null;
    isWaitlist: boolean;
    deleted: boolean;
  }>;
}

@Injectable({ providedIn: 'root' })
export class PublicApplicationsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/public-applications`;

  list(params: {
    statuses: readonly PublicApplicationStatus[];
    kind?: 'enrollment' | 'trial' | null;
  }): Observable<{ data: PublicApplication[] }> {
    const query: Record<string, string> = { status: params.statuses.join(',') };
    if (params.kind) query['kind'] = params.kind;
    return this.http.get<{ data: PublicApplication[] }>(this.endpoint, { params: query });
  }

  update(
    id: string,
    patch: { status?: PublicApplicationStatus; staffNote?: string | null },
  ): Observable<{ data: PublicApplication }> {
    return this.http.patch<{ data: PublicApplication }>(`${this.endpoint}/${id}`, patch);
  }
}
