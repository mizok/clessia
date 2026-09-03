import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

/**
 * 日到班打卡。**到班紀錄與課堂出勤是兩層** —— 人到了就是到了，即使他今天一堂課
 * 都沒有；而「他那幾堂課算出席嗎」由 API 決定（`#178`：只替他實際有報名的課寫）。
 *
 * 所以這支 service 只表達「到了」與「其實沒到」兩件事，不碰出勤。
 * 見 `kb/wiki/rules/attendance-rules.md` 第 5 節。
 */
export interface DailyCheckin {
  id: string;
  studentId: string;
  campusId: string | null;
  checkinDate: string;
  checkedInAt: string;
}

@Injectable({ providedIn: 'root' })
export class DailyCheckinsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/daily-checkins`;

  checkIn(input: {
    studentId: string;
    checkinDate: string;
    campusId?: string;
  }): Observable<DailyCheckin> {
    return this.http.post<DailyCheckin>(this.base, input);
  }

  /**
   * 取消打卡，連同它寫出來的出勤紀錄一起刪。
   *
   * **刪掉，不是改成缺席** —— 沒有紀錄 ≠ 缺席，而假的缺席會流進扣課與月結
   * （`attendance-rules.md` 第 6 節）。取消之後那幾堂回到「還沒點名」。
   */
  cancel(checkinId: string): Observable<{ attendanceRecordsRemoved: number }> {
    return this.http.delete<{ attendanceRecordsRemoved: number }>(`${this.base}/${checkinId}`);
  }
}
