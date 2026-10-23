import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type AttendanceStatus = 'present' | 'absent' | 'on_leave';
export type AttendanceSessionStatus = 'scheduled' | 'completed' | 'cancelled';

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: '到課',
  absent: '缺席',
  on_leave: '請假',
};

export const ATTENDANCE_STATUS_SEVERITIES: Record<
  AttendanceStatus,
  'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'
> = {
  present: 'success',
  absent: 'danger',
  on_leave: 'warn',
};

export interface AttendanceRecord {
  id: string;
  orgId: string;
  studentId: string;
  studentName: string;
  eventId: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  campusName: string | null;
  className: string | null;
  /**
   * **課堂本身**的狀態，不是出勤狀態。`null` = 這個 event 沒有對應的課堂。
   * 停課的課堂上面仍然可能有出勤紀錄（請假連動寫的 `on_leave` 尤其常見）——
   * 少了這個標記，一堂沒上的課會長得跟一次正常的請假一模一樣（#502）。
   */
  sessionStatus: AttendanceSessionStatus | null;
  status: AttendanceStatus;
  note: string | null;
  recordedBy: string | null;
  recordedByRole: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceListResponse {
  data: AttendanceRecord[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface AttendanceQueryParams {
  campusId?: string;
  classId?: string;
  studentId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: AttendanceStatus;
  page?: number;
  pageSize?: number;
}

/**
 * 某學生某一天的課（`GET /api/attendance/student-day`，#964 接到電話請假的送出前預覽）。
 * **是預覽不是承諾** —— 實際標成請假的以送出後 `list({ studentId })` 回來的為準。
 */
export interface StudentDaySession {
  sessionId: string;
  eventId: string | null;
  startTime: string | null;
  endTime: string | null;
  className: string;
  cancelled: boolean;
  attendance: AttendanceStatus | null;
  existingLeave: { startDate: string; endDate: string } | null;
}

export interface StudentDay {
  date: string;
  sessions: StudentDaySession[];
  /** 只在那天沒課時有值 */
  nextSession: { date: string; startTime: string | null; className: string } | null;
}

export interface UpdateAttendanceInput {
  status?: AttendanceStatus;
  note?: string | null;
}

export interface EventSessionSummary {
  /**
   * 課堂本身的 id。**這才是穩定的鍵** —— `eventId` 可能是 null，
   * 拿它當 `@for` 的 track key 會讓停課的課堂互相撞 key。
   */
  sessionId: string;
  /**
   * 出勤事件的 id。**停課的課堂沒有** —— 出勤事件是列表時才補建的，
   * 而停課的課堂刻意不補：**一次讀取不該觸發寫入**（#123 的原始理由）。
   * `null` 就是點不了名，呼叫端要據此關掉點名入口，不要當成空字串硬送。
   */
  eventId: string | null;
  /** 停課要顯示成灰底；預設查詢不含 `cancelled`，要它得明式傳 `statuses` */
  status: AttendanceSessionStatus;
  /** 實際上課的老師跟課表排定的不一致。後端算好的，前端不要自己比對 */
  isSubstitute: boolean;
  /** 這個班在這一天排了幾場校內考。0 就是沒有 */
  examCount: number;
  classId: string;
  className: string;
  /**
   * 這個班用個人聯絡簿（`true`，國小模式）還是教務日誌（`false`，預設）。
   *
   * **課堂卡靠它決定要開哪一種撰寫面板** —— 老師不該被問「這堂課是哪一種」，
   * 那是班級設定決定的事實，不是每次操作的選擇。
   * 在 #339 之前老師端拿不到這個值（`/api/classes` 是 ADMIN_ONLY），
   * 而**不准用「預設是 false」去猜** —— 那是拿統計當授權。
   */
  usesContactBook: boolean;
  courseName: string | null;
  teacherName: string | null;
  campusId: string | null;
  campusName: string | null;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  enrolledCount: number;
  presentCount: number;
  onLeaveCount: number;
  absentCount: number;
  takenAt: string | null;
  /**
   * 這堂課所在分校實際生效的出勤模式（#1314 TS3）。後端算好的 —— 老師打不到
   * `/api/campuses`，前端自己推也等於多一份判準。日到班的課沒有逐堂點名，入口是到班名單。
   */
  attendanceMode: 'daily_checkin' | 'per_session';
  /**
   * 日到班的課：在籍學生裡當天有到班打卡的人數；隨堂是 null。
   * **不要拿 `presentCount` 代**：掃碼只寫得到打卡當下已存在的 event，兩個數字會分岔。
   */
  checkedInCount: number | null;
}

export interface RosterStudent {
  studentId: string;
  studentName: string;
  grade: string | null;
  school: string | null;
  recordId: string | null;
  /** 紀錄上寫了什麼。`null` = 這堂課還沒有這個學生的出勤紀錄 */
  status: 'present' | 'absent' | 'on_leave' | null;
  /**
   * 今天有一張蓋到這堂課的請假單。**跟 `status === 'on_leave'` 是兩件事**：
   * `status` 是紀錄上寫了什麼（事實），這個是有沒有請假這件事（脈絡）。
   *
   * 後端讀取時推導，不看紀錄 —— 因為請假連動只寫得到「建立請假當下已存在」的 event，
   * 而出勤事件是懶生成的：先請假、之後才生成的課堂，紀錄上什麼都沒有。
   *
   * **不要用它來鎖住那一列。** 鎖住的條件只有 `status === 'on_leave'`，
   * 理由見 `attendance-roster-panel.component.ts` 的 `isLocked`。
   */
  hasLeaveRequest: boolean;
  /**
   * 銷假會不會連坐取消後續日期 —— 會的話是**最後被取消的那一天**，不會就是 `null`（#265）。
   *
   * **伺服器端逐張假算，而且直接用銷假自己那支 `cancelLeaveForDate`** ——
   * 預測與實際動作共用同一份實作，不會出現「預覽說會、按下去卻不會」。
   *
   * 在此之前前端拿的是 `leaveStartDate` / `leaveEndDate`（聚合的最早起日與最晚迄日），
   * 用它們推導連坐會在「兩張假接力」時同形而無法分辨，文案因此只能說「可能」。
   * 那兩個欄位 API 仍然回，但**前端沒有任何地方讀它們了**，所以不列在這個介面裡。
   */
  cancelDropsLeaveUntil: string | null;
  /** 當天到班打卡的時間；沒打卡是 null（日到班的到班名單用，#1314 TS3） */
  checkedInAt: string | null;
  /** 那筆到班的來源（#1100 #52）；這欄出現之前的紀錄是 null —— 名單上只寫時間 */
  checkInSource?: 'scan' | 'manual' | null;
}

export interface AttendanceRoster {
  eventId: string;
  takenAt: string | null;
  attendanceMode: 'daily_checkin' | 'per_session';
  students: RosterStudent[];
}

export interface AttendanceSessionListResponse {
  data: EventSessionSummary[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface CancelLeaveResult {
  leavesDeleted: number;
  /** 跨日的假只拿掉這一天 —— 縮短範圍而不是整張刪掉 */
  leavesTruncated: number;
  attendanceRecordsRemoved: number;
  /**
   * 今天卡在請假區間中間時，後段被連坐取消到哪一天。`null` = 沒有連坐。
   * 非 null 時前端**必須**告訴老師，那是「截斷而不是切成兩張」的代價。
   */
  droppedAfter: string | null;
}

export interface BatchAttendanceUpdate {
  eventId: string;
  updates: { studentId: string; status: 'present' | 'absent' }[];
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/api/attendance`;

  list(params: AttendanceQueryParams): Observable<AttendanceListResponse> {
    let httpParams = new HttpParams();
    if (params.campusId) httpParams = httpParams.set('campusId', params.campusId);
    if (params.classId) httpParams = httpParams.set('classId', params.classId);
    if (params.studentId) httpParams = httpParams.set('studentId', params.studentId);
    if (params.dateFrom) httpParams = httpParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) httpParams = httpParams.set('dateTo', params.dateTo);
    if (params.status) httpParams = httpParams.set('status', params.status);
    if (params.page) httpParams = httpParams.set('page', params.page);
    if (params.pageSize) httpParams = httpParams.set('pageSize', params.pageSize);
    return this.http.get<AttendanceListResponse>(this.baseUrl, { params: httpParams });
  }

  studentDay(studentId: string, date: string): Observable<{ data: StudentDay }> {
    return this.http.get<{ data: StudentDay }>(`${this.baseUrl}/student-day`, {
      params: new HttpParams().set('studentId', studentId).set('date', date),
    });
  }

  update(id: string, input: UpdateAttendanceInput): Observable<AttendanceRecord> {
    return this.http.patch<AttendanceRecord>(`${this.baseUrl}/${id}`, input);
  }

  sessions(params: {
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    campusId?: string;
    courseIds?: string[];
    classIds?: string[];
    statuses?: AttendanceSessionStatus[];
    /**
     * 出勤點了沒 —— **跟 `statuses`（課堂狀態）是兩件事**。
     *
     * `false` 搭 `pageSize: 1` 取 `meta.total`，數字由伺服器算。
     * 前端撈明細自己數會在破 100 筆的區間悄悄少算，而且錯得沒有徵兆。
     */
    attendanceTaken?: boolean;
    /**
     * 只回「已經上完」的課堂——`hasSessionEndedByNow()` 的語意搬到後端。
     * 配 `attendanceTaken: false` 一次查出「沒點名而且已經上完」，不必再對
     * `workbench/today` 的明細逐筆用 `hasSessionEnded` 濾一次。
     */
    endedOnly?: boolean;
    page?: number;
    pageSize?: number;
  }): Observable<AttendanceSessionListResponse> {
    let p = new HttpParams();
    if (params.date) p = p.set('date', params.date);
    if (params.dateFrom) p = p.set('dateFrom', params.dateFrom);
    if (params.dateTo) p = p.set('dateTo', params.dateTo);
    // `!== undefined` 不是 truthy —— 這張卡要的正是 `false`
    if (params.attendanceTaken !== undefined)
      p = p.set('attendanceTaken', String(params.attendanceTaken));
    if (params.endedOnly) p = p.set('endedOnly', 'true');
    if (params.campusId) p = p.set('campusId', params.campusId);
    if (params.courseIds && params.courseIds.length > 0) {
      p = p.set('courseIds', params.courseIds.join(','));
    }
    if (params.classIds && params.classIds.length > 0)
      p = p.set('classIds', params.classIds.join(','));
    if (params.statuses && params.statuses.length > 0)
      p = p.set('statuses', params.statuses.join(','));
    if (params.page) p = p.set('page', params.page);
    if (params.pageSize) p = p.set('pageSize', params.pageSize);
    return this.http.get<AttendanceSessionListResponse>(`${this.baseUrl}/sessions`, { params: p });
  }

  roster(eventId: string): Observable<AttendanceRoster> {
    return this.http.get<AttendanceRoster>(`${this.baseUrl}/roster/${eventId}`);
  }

  /**
   * 銷假：請假的學生今天出現了。
   *
   * **走 `/api/attendance` 而不是 `/api/leaves`** —— 後者掛 ADMIN_ONLY，
   * 而且它的 DELETE 帶著 `mode=truncate|full` 的語意，老師站在點名面板前面
   * 不該去理解那個。這支用 eventId 進去，班級（範圍檢查）、日期、學生一次到齊。
   *
   * `droppedAfter` 非 null 代表今天卡在請假區間中間、後段被連坐取消 ——
   * **呼叫端必須把這件事講出來**，不能默默吃掉。
   */
  cancelLeave(eventId: string, studentId: string): Observable<CancelLeaveResult> {
    return this.http.post<CancelLeaveResult>(`${this.baseUrl}/roster/${eventId}/cancel-leave`, {
      studentId,
    });
  }

  /**
   * 日到班的「他到了」：替沒掃碼的學生記一筆到班（效果同掃碼）。
   * 後端限老師自己的課、當天、在籍、日到班分校，行政負責點名時 403。
   */
  checkIn(
    eventId: string,
    studentId: string,
  ): Observable<{
    checkedInAt: string;
    alreadyCheckedIn: boolean;
    checkInSource?: 'scan' | 'manual' | null;
  }> {
    return this.http.post<{
      checkedInAt: string;
      alreadyCheckedIn: boolean;
      checkInSource?: 'scan' | 'manual' | null;
    }>(`${this.baseUrl}/roster/${eventId}/check-in`, { studentId });
  }

  batchUpdate(input: BatchAttendanceUpdate): Observable<{ updated: number; takenAt: string }> {
    return this.http.patch<{ updated: number; takenAt: string }>(`${this.baseUrl}/batch`, input);
  }
}
