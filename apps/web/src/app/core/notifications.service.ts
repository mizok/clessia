import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../../environments/environment';

/** 一則通知（#1688）。排程寫進 `notifications` 的紀錄；推播只是其中一種送達管道 */
export interface AppNotification {
  readonly id: string;
  /** `invoice_due`／`invoice_overdue`／`schedule_change`… */
  readonly kind: string;
  readonly title: string;
  /** 不含金額 —— 看金額請點 link */
  readonly body: string;
  readonly createdAt: string;
  readonly isRead: boolean;
  /** 點了要去的頁（例：`/parent/payments`）；沒有就 null */
  readonly link: string | null;
  /** 課務異動有「原本／改為」可以展開（#1100 #49） */
  readonly hasChangeDetail: boolean;
}

export interface ChangeSlot {
  readonly date: string;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly teacherName: string | null;
}

/** `GET /api/notifications/{id}/schedule-change` 的一堂：原本／改為（停課的 now 是 null；原因只有停課有） */
export interface ChangeDetailRow {
  readonly sessionId: string;
  readonly className: string | null;
  readonly changeType: string;
  readonly was: ChangeSlot;
  readonly now: ChangeSlot | null;
  readonly reason: string | null;
}

export interface NotificationInboxResponse {
  readonly data: AppNotification[];
  /** total／unread 是全部的數，清單最多 100 則 */
  readonly meta: { total: number; unread: number };
}

/** 通知 API —— 伺服器依 active role 過濾，前端不帶參數；形狀對齊公告 inbox */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/notifications`;

  inbox(): Observable<NotificationInboxResponse> {
    return this.http.get<NotificationInboxResponse>(`${this.base}/inbox`);
  }

  /** 家長展開課務異動通知（#1100 #49）：即時算的原本／改為，只回自己孩子在籍的堂 */
  changeDetail(id: string): Observable<{ data: ChangeDetailRow[] }> {
    return this.http.get<{ data: ChangeDetailRow[] }>(`${this.base}/${id}/schedule-change`);
  }

  markRead(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/read`, {});
  }

  /** 這個身分全部標已讀。原子 */
  markAllRead(): Observable<{ marked: number }> {
    return this.http.post<{ marked: number }>(`${this.base}/read-all`, {});
  }
}
