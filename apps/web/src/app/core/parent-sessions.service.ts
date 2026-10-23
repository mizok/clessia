import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '@env/environment';

export type ParentSessionStatus = 'scheduled' | 'completed' | 'cancelled';
export type ParentChangeType = 'reschedule' | 'substitute' | 'cancellation';

export interface ParentSessionChange {
  changeType: ParentChangeType;
  originalDate: string | null;
  originalStartTime: string | null;
  originalEndTime: string | null;
  newDate: string | null;
  newStartTime: string | null;
  newEndTime: string | null;
  /** 只有停課有值（#1100 #46）；改期、代課一律 null */
  reason: string | null;
}

/** `GET /api/me/sessions` 的一堂課（apps/api/src/routes/parent/sessions.ts `ParentSessionSchema`） */
export interface ParentSession {
  sessionId: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: ParentSessionStatus;
  classId: string;
  className: string | null;
  courseName: string | null;
  /** 班的分校（#1075，家長到班頁判斷今天要不要刷卡） */
  campusId: string | null;
  campusName: string | null;
  /** 班開了個人聯絡簿（國小模式）：詳情顯示當天的聯絡簿＋簽收，不顯示教務日誌的作業（#1100 #26） */
  usesContactBook: boolean;
  /** 這堂課分校的電話（#1100 #44）；只會是孩子有報名的分校 */
  campusPhone: string | null;
  /** 排課時段指定的教室（#1796）；手動加的堂、補課、沒指定 → null */
  classroomName: string | null;
  teacherName: string | null;
  isSubstitute: boolean;
  originalTeacherName: string | null;
  examCount: number;
  /** 那天這班的校內考名稱（只有名稱） */
  examNames: string[];
  changes: ParentSessionChange[];
  attendance: {
    status: 'present' | 'absent' | 'on_leave';
    checkedInAt: string | null;
  } | null;
}

/** `GET /api/me/class-logs` 的一篇已發布日誌（只有作業；教學紀錄不回） */
export interface ParentClassLog {
  id: string;
  classId: string;
  className: string | null;
  logDate: string;
  homework: string;
}

/** `GET /api/me/contact-book` 的一則個人聯絡簿（學生 × 日期；#1100 #26） */
export interface ParentContactBookEntry {
  id: string;
  entryDate: string;
  content: string;
  lastEditedByName: string | null;
  updatedAt: string;
  signedAt: string | null;
  /** 簽收的人（可能是另一位家長） */
  signedByName: string | null;
  /** 簽收之後內容又改過 → 顯示「有更新」 */
  editedAfterSign: boolean;
}

@Injectable({ providedIn: 'root' })
export class ParentSessionsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/me`;

  /** 日期窗必填、上限 42 天（API 端擋） */
  list(childId: string, dateFrom: string, dateTo: string): Observable<{ data: ParentSession[] }> {
    return this.http.get<{ data: ParentSession[] }>(`${this.base}/sessions`, {
      params: { childId, dateFrom, dateTo },
    });
  }

  homework(
    childId: string,
    dateFrom: string,
    dateTo: string,
  ): Observable<{ data: ParentClassLog[] }> {
    return this.http.get<{ data: ParentClassLog[] }>(`${this.base}/class-logs`, {
      params: { childId, dateFrom, dateTo, pageSize: 100 },
    });
  }

  /** 日期窗必填、上限 120 天（API 端擋） */
  contactBook(
    childId: string,
    dateFrom: string,
    dateTo: string,
  ): Observable<{ data: ParentContactBookEntry[] }> {
    return this.http.get<{ data: ParentContactBookEntry[] }>(`${this.base}/contact-book`, {
      params: { childId, dateFrom, dateTo },
    });
  }

  /** 已閱簽收；已經有人簽過就回現狀（不覆蓋） */
  signContactBook(entryId: string): Observable<ParentContactBookEntry> {
    return this.http.post<ParentContactBookEntry>(`${this.base}/contact-book/${entryId}/sign`, {});
  }
}
