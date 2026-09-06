import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

/** 三態，跟系統的既有出勤狀態一致——**沒有「遲到」**，全系統從來沒有這個狀態 */
export type ParentAttendanceStatus = 'present' | 'absent' | 'on_leave';

export interface ParentAttendanceRecord {
  id: string;
  eventId: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
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
}
