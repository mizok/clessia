import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export interface SessionPack {
  id: string;
  enrollmentId: string;
  purchasedCount: number;
  purchasedAt: string;
  expiresAt: string | null;
  invoiceItemId: string | null;
  note: string | null;
  createdAt: string;
}

export interface SessionPackSummary {
  purchased: number;
  deducted: number;
  /** 可以是負數 —— 堂數用完不硬擋上課，負數就是該追補買的訊號 */
  remaining: number;
  leaveDeductsSession: boolean;
}

export interface SessionPackListResponse {
  data: SessionPack[];
  summary: SessionPackSummary;
}

export interface CreateSessionPackInput {
  enrollmentId: string;
  purchasedCount: number;
  purchasedAt?: string;
  expiresAt?: string | null;
  invoiceItemId?: string;
  note?: string;
}

@Injectable({ providedIn: 'root' })
export class SessionPacksService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/session-packs`;

  list(enrollmentId: string): Observable<SessionPackListResponse> {
    return this.http.get<SessionPackListResponse>(this.base, { params: { enrollmentId } });
  }

  create(input: CreateSessionPackInput): Observable<{ data: SessionPack }> {
    return this.http.post<{ data: SessionPack }>(this.base, input);
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/${id}`);
  }
}
