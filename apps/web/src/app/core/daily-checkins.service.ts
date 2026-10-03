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

/** POST 的回應：打卡那筆＋給機台畫面的確認資訊（#1127，只有剛打卡的那一位） */
export interface DailyCheckinConfirmation extends DailyCheckin {
  student: { name: string };
  /** 重掃：當天已經打過，`checkedInAt` 是第一次那筆 */
  alreadyCheckedIn: boolean;
  /** 分校層級的出勤模式。課堂模式只記到班，出席由老師點名 */
  attendanceMode: 'daily_checkin' | 'per_session';
  /** 當天有在籍、沒停課的課堂，依開始時間排序 */
  todaySessions: Array<{
    sessionId: string;
    className: string;
    startTime: string;
    endTime: string;
    /** 有假單蓋到這堂 */
    onLeave: boolean;
    /** 寫完之後這堂實際的出勤紀錄；null＝還沒有 */
    attendance: 'present' | 'absent' | 'on_leave' | null;
  }>;
}

@Injectable({ providedIn: 'root' })
export class DailyCheckinsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/daily-checkins`;

  checkIn(input: {
    studentId: string;
    checkinDate: string;
    campusId?: string;
  }): Observable<DailyCheckinConfirmation> {
    return this.http.post<DailyCheckinConfirmation>(this.base, input);
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
