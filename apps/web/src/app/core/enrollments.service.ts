import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type EnrollmentStatus = 'pending_payment' | 'active' | 'suspended' | 'withdrawal' | 'void';
/**
 * 計費模式。**掛在報名上不是班級上** —— 同一班可以同時有月繳生與期繳生
 * （kb/wiki/rules/billing-rules.md 規則 1）。取代了舊的 `PaymentCycle`：
 * 舊的 `semester` 對應到 `period`，差別是新制的「期」是機構自訂的日期區間。
 */
export type BillingMode = 'monthly' | 'period' | 'session_pack';

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  pending_payment: '待付款',
  active: '在籍',
  suspended: '暫停',
  withdrawal: '退班',
  void: '失效',
};

export interface Enrollment {
  id: string;
  orgId: string;
  classId: string;
  className: string;
  campusId: string | null;
  campusName: string | null;
  courseId: string;
  courseName: string;
  studentId: string;
  studentName: string;
  studentSchool: string;
  studentGrade: string;
  status: EnrollmentStatus;
  billingMode: BillingMode | null;
  feeTemplateId: string | null;
  /** 談定的每月／每期金額，與價目表的定價分開（議價是常態） */
  agreedAmount: number | null;
  adjustmentNote: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  attendanceCount: number;
}

export interface ScheduleConflictWarning {
  studentId: string;
  conflictingClassId: string;
  conflictingClassName: string;
  conflictingCourseName: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface CreateEnrollmentInput {
  classId: string;
  studentId: string;
  status?: 'pending_payment' | 'active';
  billingMode?: BillingMode;
  feeTemplateId?: string;
  agreedAmount?: number;
  adjustmentNote?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  notes?: string;
  skipConflictCheck?: boolean;
}

export interface UpdateEnrollmentInput {
  billingMode?: BillingMode | null;
  feeTemplateId?: string | null;
  agreedAmount?: number | null;
  adjustmentNote?: string | null;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  notes?: string | null;
}

export interface EnrollmentListResponse {
  data: Enrollment[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface EnrollmentQueryParams {
  classId?: string;
  studentId?: string;
  campusId?: string;
  status?: EnrollmentStatus;
  /** 期間內「發生過事情」：這段期間開始生效（新報名）或結束（退班） */
  from?: string;
  to?: string;
  /** 預設 createdAt；進出總覽用 updatedAt，見 list-query.ts */
  sort?: 'createdAt' | 'updatedAt';
  /**
   * `false` = 從來沒開過任何帳單的報名（待開帳清單）；`true` = 開過的。
   *
   * 兩個方向在後端走**不同的 join**（`true` 用 `invoice_items!inner`，
   * `false` 用 left join 加 `is.null`）—— 這裡只要傳 boolean，別自己組 filter。
   */
  hasInvoice?: boolean;
  page?: number;
  pageSize?: number;
}

export interface BatchCreateResultItem {
  studentId: string;
  status: 'enrolled' | 'already_exists' | 'error';
  enrollmentId?: string;
  message?: string;
}

export interface BatchCreateInput {
  classId: string;
  studentIds: string[];
  skipConflictCheck?: boolean;
  /** 不給就是今天。名單補灌時往前調到開課日，過去的課堂名單才有人 */
  effectiveFrom?: string;
  /**
   * 計費設定 —— 整批同一組（同一班同一個價目表是常態）。
   *
   * API 從一開始就吃這三個欄位，理由寫在 `routes/enrollments.ts`：
   * 「批次招生一次幾十筆，事後逐筆補計費設定是純粹的重工」。
   * 但這裡的型別漏了，於是呼叫端也就沒人送 —— schema 有欄位不等於有人在用。
   *
   * `adjustmentNote` 由 PR #184 補齊（原本單筆吃、批次不吃）——
   * **這支的合併必須排在 #184 之後**，否則改了價的原因會被後端 strip 掉，
   * 而畫面上使用者剛填過它。
   */
  billingMode?: BillingMode;
  feeTemplateId?: string;
  agreedAmount?: number;
  adjustmentNote?: string;
}

export interface BatchCreateResult {
  results: BatchCreateResultItem[];
  warnings?: ScheduleConflictWarning[];
}

export interface CreateEnrollmentResponse {
  data: Enrollment;
  warnings?: ScheduleConflictWarning[];
}

export interface CopyFromClassInput {
  targetClassId: string;
  sourceClassId: string;
  statuses: EnrollmentStatus[];
}

export interface CopyFromClassResult {
  copied: number;
  skipped: number;
}

export interface BatchMatchItem {
  name: string;
  school: string;
}

export interface BatchMatchCandidate {
  id: string;
  name: string;
  grade: string;
  school: string;
  birthday?: string | null;
}

export interface BatchMatchResultItem {
  index: number;
  status: 'matched' | 'ambiguous' | 'not_found' | 'already_enrolled';
  studentId?: string;
  candidates?: BatchMatchCandidate[];
}

export interface BatchMatchResponse {
  results: BatchMatchResultItem[];
}

@Injectable({ providedIn: 'root' })
export class EnrollmentsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/enrollments`;

  list(params: EnrollmentQueryParams = {}): Observable<EnrollmentListResponse> {
    const query = new URLSearchParams();
    if (params.classId) query.set('classId', params.classId);
    if (params.studentId) query.set('studentId', params.studentId);
    if (params.campusId) query.set('campusId', params.campusId);
    if (params.status) query.set('status', params.status);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    if (params.sort) query.set('sort', params.sort);
    // **`!== undefined` 不是 truthy 檢查** —— 待開帳清單要的正是 `false`，
    // 寫成 `if (params.hasInvoice)` 會把它靜靜地漏掉，然後撈回全部報名
    if (params.hasInvoice !== undefined) query.set('hasInvoice', String(params.hasInvoice));
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    return this.http.get<EnrollmentListResponse>(`${this.base}?${query}`);
  }

  create(input: CreateEnrollmentInput): Observable<CreateEnrollmentResponse> {
    return this.http.post<CreateEnrollmentResponse>(this.base, input);
  }

  batchCreate(input: BatchCreateInput): Observable<BatchCreateResult> {
    return this.http.post<BatchCreateResult>(`${this.base}/batch`, input);
  }

  update(id: string, input: UpdateEnrollmentInput): Observable<{ data: Enrollment }> {
    return this.http.patch<{ data: Enrollment }>(`${this.base}/${id}`, input);
  }

  updateStatus(
    id: string,
    status: EnrollmentStatus,
    notes?: string,
  ): Observable<{ data: Enrollment }> {
    return this.http.patch<{ data: Enrollment }>(`${this.base}/${id}/status`, { status, notes });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  batchMatch(classId: string, items: BatchMatchItem[]): Observable<BatchMatchResponse> {
    return this.http.post<BatchMatchResponse>(`${this.base}/batch-match`, { classId, items });
  }

  copyFromClass(input: CopyFromClassInput): Observable<CopyFromClassResult> {
    return this.http.post<CopyFromClassResult>(`${this.base}/copy-from-class`, input);
  }
}
