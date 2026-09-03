import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../../environments/environment';

export type AnnouncementAudience = 'all_teachers' | 'all_parents';

export const AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  all_teachers: '全體老師',
  all_parents: '全體家長',
};

export interface Announcement {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly audience: AnnouncementAudience;
  readonly campusId: string | null;
  readonly campusName: string | null;
  readonly publishedAt: string;
  readonly createdByName: string | null;
  readonly isRead: boolean;
}

export interface AnnouncementListResponse {
  readonly data: Announcement[];
  readonly meta: { total: number; unread: number };
}

export interface CreateAnnouncementInput {
  readonly title: string;
  readonly body: string;
  readonly audience: AnnouncementAudience;
  /** null = 全分校 */
  readonly campusId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AnnouncementsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/announcements`;

  /** 管理端：發過哪些 */
  list(params: { audience?: AnnouncementAudience; campusId?: string } = {}) {
    const query = new URLSearchParams();
    if (params.audience) query.set('audience', params.audience);
    if (params.campusId) query.set('campusId', params.campusId);
    return this.http.get<AnnouncementListResponse>(`${this.base}?${query}`);
  }

  /** 收件匣。看得到哪些由後端依角色與分校決定 */
  inbox(): Observable<AnnouncementListResponse> {
    return this.http.get<AnnouncementListResponse>(`${this.base}/inbox`);
  }

  create(input: CreateAnnouncementInput): Observable<{ data: Announcement }> {
    return this.http.post<{ data: Announcement }>(this.base, input);
  }

  markRead(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/read`, {});
  }

  /**
   * 收件匣全部標為已讀。**原子** —— 要嘛全標要嘛都沒標，沒有「一半已讀」這種狀態。
   *
   * 可見範圍由後端算，跟 `inbox()` 同源（`campusOrFilter` + `audienceFor`），
   * 所以 `marked` 不需要跟前端的未讀數對帳 —— 兩邊各算一次才是會漂的做法。
   */
  markAllRead(): Observable<{ marked: number }> {
    return this.http.post<{ marked: number }>(`${this.base}/read-all`, {});
  }
}
