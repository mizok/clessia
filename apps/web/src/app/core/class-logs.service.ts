import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../../environments/environment';

/**
 * 教務日誌：**一班一天一篇**（`class_logs` 的唯一鍵是 `(class_id, log_date)`）。
 *
 * 設計與 v1a/v1b 邊界見 `kb/wiki/architecture/teacher-class-log.md`。
 * 這一版**沒有 publish** —— 後端有那支端點，但發布不可逆而下游（家長端可見、
 * LINE 推播）都還不存在，所以前端刻意不提供入口。
 */
export interface ClassLog {
  readonly id: string;
  readonly classId: string;
  readonly className: string | null;
  readonly logDate: string;
  /** 內部用。規則明說老師會在這裡寫不給家長看的話 */
  readonly teachingRecord: string | null;
  /** 家長看得到（v1b 家長端做出來之後） */
  readonly homework: string | null;
  readonly lastEditedByName: string | null;
  /** 已發布的時間；`null` = 草稿。v1a 不寫它，只讀 */
  readonly publishedAt: string | null;
}

export interface ClassLogListResponse {
  readonly data: ClassLog[];
  readonly meta: { total: number };
}

export interface UpsertClassLogInput {
  readonly classId: string;
  readonly logDate: string;
  /** 兩欄都可留白 —— 老師可能先寫作業、下課後再補教學紀錄 */
  readonly teachingRecord?: string;
  readonly homework?: string;
}

@Injectable({ providedIn: 'root' })
export class ClassLogsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/class-logs`;

  /**
   * 後端依角色收斂範圍：老師只拿得到自己任課班的日誌（`taughtClassIds`），
   * 所以這裡不需要、也不該傳老師 id。
   */
  list(params: { classId?: string; from?: string; to?: string } = {}): Observable<ClassLogListResponse> {
    let httpParams = new HttpParams();
    if (params.classId) httpParams = httpParams.set('classId', params.classId);
    if (params.from) httpParams = httpParams.set('from', params.from);
    if (params.to) httpParams = httpParams.set('to', params.to);
    return this.http.get<ClassLogListResponse>(this.base, { params: httpParams });
  }

  /** `PUT` 是 upsert（`onConflict: class_id,log_date`）—— 同一天存第二次是編輯不是新增 */
  upsert(input: UpsertClassLogInput): Observable<{ data: ClassLog }> {
    return this.http.put<{ data: ClassLog }>(this.base, input);
  }
}
