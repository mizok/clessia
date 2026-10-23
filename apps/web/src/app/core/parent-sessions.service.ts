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
}
