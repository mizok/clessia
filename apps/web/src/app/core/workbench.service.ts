import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';
import type { EventSessionSummary } from './attendance.service';
import type { AttendanceMode } from './org-settings.service';

/**
 * 作業台的取數。**一支取代四支。**
 *
 * 管理端儀表板原本打 8 支請求（`dashboard.component.ts` 的逐支訂閱），而
 * 2026-09-03 的延遲拆段顯示：**查詢執行只佔 1 毫秒，延遲幾乎全是「每次請求的
 * 固定成本 × 請求次數」** —— 減次數比讓每支變快有效得多。
 *
 * 第二個理由跟效能無關：兩套取數會各長一份分校過濾與在籍判斷，然後其中一份會
 * 忘記更新。**形狀的判斷只有一份，在伺服器。**
 *
 * 設計見 `kb/wiki/architecture/today-workbench.md`。
 */

/** 日到班模式：今天有課的班的在籍學生 —— 也就是「今天應該有誰」 */
export interface WorkbenchExpectedStudent {
  studentId: string;
  studentName: string;
  grade: string | null;
  campusId: string | null;
  campusName: string | null;
  /** 他今天第一堂課。行政要靠它確認是不是找錯人 */
  firstSession: { startTime: string | null; className: string } | null;
}

export interface WorkbenchArrival {
  studentId: string;
  checkedInAt: string;
  checkinId: string;
}

export interface WorkbenchLeave {
  studentId: string;
  studentName: string;
  startDate: string;
  endDate: string;
  submittedByRole: string;
}

export interface WorkbenchToday {
  date: string;
  /**
   * **伺服器讀 `organizations.attendance_mode`，前端不傳。**
   * 讓呼叫端傳等於同一個機構可能拿到兩種形狀，而那個不一致沒有人會發現。
   */
  mode: AttendanceMode;
  sessions: EventSessionSummary[];
  /** 逐堂模式用。**不適用時是空陣列，不是缺欄位** —— 缺欄位會讓這裡到處寫 `?.` */
  rosters: {
    eventId: string;
    enrolledCount: number;
    presentCount: number;
    onLeaveCount: number;
    takenAt: string | null;
  }[];
  expected: WorkbenchExpectedStudent[];
  arrived: WorkbenchArrival[];
  onLeave: WorkbenchLeave[];
}

@Injectable({ providedIn: 'root' })
export class WorkbenchService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/workbench`;

  /**
   * `date` 不給就是台北時區的今天。**作業台要看得了昨天** —— 補登就是昨天的事，
   * 所以日期是參數而不是伺服器寫死。
   *
   * `campusId` 不給就吃呼叫者的分校範圍（`#175` 的 `campusScope`）。
   */
  today(params: { date?: string; campusId?: string } = {}): Observable<WorkbenchToday> {
    const query = new URLSearchParams();
    if (params.date) query.set('date', params.date);
    if (params.campusId) query.set('campusId', params.campusId);
    const suffix = query.size > 0 ? `?${query}` : '';

    return this.http.get<WorkbenchToday>(`${this.base}/today${suffix}`);
  }
}
