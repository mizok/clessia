import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import type { CreateLeaveInput } from '@core/leave.service';

/** 三態，跟系統的既有出勤狀態一致——**沒有「遲到」**，全系統從來沒有這個狀態 */
export type ParentAttendanceStatus = 'present' | 'absent' | 'on_leave';

export interface ParentAttendanceRecord {
  id: string;
  eventId: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  /** 課堂的分校（#1075）：對 `dailyCheckinCampusIds` 決定那天畫不畫到班行 */
  campusId: string | null;
  campusName: string | null;
  className: string | null;
  /**
   * **課堂本身**的狀態。停課的課堂上面仍然可能有一筆 `on_leave`
   *（請假在停課之前送的）—— 少了這個標記，家長會把它讀成一次正常的請假，
   * 而老師端同一件事有「停課」標籤（#502）。
   */
  sessionStatus: 'scheduled' | 'completed' | 'cancelled' | null;
  status: ParentAttendanceStatus;
  note: string | null;
  /** 請假的堂是誰登記的；不是請假或找不到假單 → null（#1695 第 4 張） */
  leaveSubmittedBy: 'parent' | 'school' | null;
  /** 請假原因：只有家長自己送的才有，補習班登記的 API 一律回 null（計畫席 10-19 裁 (A)） */
  leaveReason: string | null;
}

export interface ParentAttendanceListResponse {
  data: ParentAttendanceRecord[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    /**
     * 這個孩子本月（自然月，到今天為止）**缺席**的筆數。
     *
     * **不含請假，也不隨查詢區間變動** —— 後端固定用 `monthStart()` 算
     * （`apps/api/src/routes/parent/attendance.ts:126-140`），所以列表看的是近30天或
     * 上個月時，這個數字仍然是「本月」。顯示它的地方必須把「本月」寫出來。
     */
    monthlyAbsentCount: number;
    /**
     * 這個孩子本月（自然月，到今天為止）**請假**的筆數。
     *
     * 目前沒有畫面顯示它（計畫席裁定錨點只放缺席：請假是家長自己送出的，他已經知道，
     * 併進去會虛增焦慮）。**留著宣告是因為 API 真的會回它** —— 拿掉的話，
     * 下一個想做「本月請假 N 次」的人會以為要先開 API 需求單。
     */
    monthlyOnLeaveCount: number;
  };
}

/**
 * `GET /api/me/attendance/days`（#1810）的一列：**一堂課**，不是一筆出勤紀錄 ——
 * 沒點名的堂也在（`status` 是 null）。設計見 kb/wiki/specs/parent/attendance.md「列出還沒點名的堂」。
 */
export interface ParentAttendanceDayRow {
  /** 穩定鍵：有課堂用課堂 id，非課堂事件用出勤紀錄 id */
  id: string;
  sessionId: string | null;
  eventId: string | null;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  campusId: string | null;
  campusName: string | null;
  className: string | null;
  sessionStatus: 'scheduled' | 'completed' | 'cancelled' | null;
  /** 出勤紀錄上寫的；`null`＝沒有紀錄 —— **不等於缺席** */
  status: ParentAttendanceStatus | null;
  /** 沒紀錄時的推導：`leave` 有假單蓋到、`checkin` 日到班當天刷了卡 */
  derived: 'leave' | 'checkin' | null;
  note: string | null;
  leaveSubmittedBy: 'parent' | 'school' | null;
  leaveReason: string | null;
  teacherName: string | null;
  classroomName: string | null;
}

export interface ParentAttendanceDaysResponse {
  data: ParentAttendanceDayRow[];
  /** 同 `ParentAttendanceListResponse.meta` 的兩個月度數字（紀錄為準、自然月至今） */
  meta: { monthlyAbsentCount: number; monthlyOnLeaveCount: number };
}

/** `GET /api/me/attendance/checkins`（#1075）：每日到班時間＋哪些分校是日到班 */
export interface ParentCheckinsResponse {
  /** 每一次到班：日期與台北時間 `HH:mm` */
  data: Array<{ date: string; time: string }>;
  /** 孩子報過名的分校裡，生效模式是日到班的那些 */
  dailyCheckinCampusIds: string[];
}

export interface ParentAttendanceListParams {
  childId: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

@Injectable({ providedIn: 'root' })
export class ParentAttendanceService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/me/attendance`;

  list(params: ParentAttendanceListParams): Observable<ParentAttendanceListResponse> {
    const query: Record<string, string | number> = { childId: params.childId };
    if (params.dateFrom !== undefined) query['dateFrom'] = params.dateFrom;
    if (params.dateTo !== undefined) query['dateTo'] = params.dateTo;
    if (params.page !== undefined) query['page'] = params.page;
    if (params.pageSize !== undefined) query['pageSize'] = params.pageSize;

    return this.http.get<ParentAttendanceListResponse>(this.base, { params: query });
  }

  /** 窗內每一堂（含沒點名的）。區間最多 42 天，後端擋（#1810） */
  days(
    childId: string,
    dateFrom: string,
    dateTo: string,
  ): Observable<ParentAttendanceDaysResponse> {
    return this.http.get<ParentAttendanceDaysResponse>(`${this.base}/days`, {
      params: { childId, dateFrom, dateTo },
    });
  }

  /** 區間最多 366 天，後端擋 */
  checkins(childId: string, dateFrom: string, dateTo: string): Observable<ParentCheckinsResponse> {
    return this.http.get<ParentCheckinsResponse>(`${this.base}/checkins`, {
      params: { childId, dateFrom, dateTo },
    });
  }

  /**
   * 家長幫孩子請假（#1695，`POST /api/me/leaves`）：送出即生效。錯誤碼 `NO_SESSIONS`／`ALL_ATTENDED`（400）、
   * `LEAVE_OVERLAP`（409）由共用表單顯示在表單裡
   */
  createLeave(body: CreateLeaveInput): Observable<unknown> {
    return this.http.post(`${environment.apiUrl}/api/me/leaves`, body);
  }
}
