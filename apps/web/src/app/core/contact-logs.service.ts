import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

/** 聯絡紀錄（#1314 D2）：儀表板「該到沒到」與學生檔案的打電話／傳 LINE 都記一筆。只增不改不刪 */
export type ContactChannel = 'phone' | 'line' | 'other';

export interface ContactLog {
  id: string;
  studentId: string;
  channel: ContactChannel;
  note: string | null;
  parentId: string | null;
  parentName: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface CreateContactLogInput {
  studentId: string;
  channel: ContactChannel;
  /** 必須是這個學生的家長，否則 404 `PARENT_NOT_FOUND` */
  parentId?: string;
  /** 上限 500 字 */
  note?: string;
}

@Injectable({ providedIn: 'root' })
export class ContactLogsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/api/contact-logs`;

  /** 新到舊；`limit` 預設 50、上限 200 */
  list(studentId: string, limit?: number): Observable<{ data: ContactLog[] }> {
    const params: Record<string, string> = { studentId };
    if (limit !== undefined) params['limit'] = String(limit);
    return this.http.get<{ data: ContactLog[] }>(this.baseUrl, { params });
  }

  /** 寫入要 `basic_operations` 或 `manage_students` 任一（老師限任課學生） */
  create(input: CreateContactLogInput): Observable<{ data: ContactLog }> {
    return this.http.post<{ data: ContactLog }>(this.baseUrl, input);
  }
}
