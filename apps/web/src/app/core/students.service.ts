import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type GradeLevel =
  'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'J1' | 'J2' | 'J3' | 'S1' | 'S2' | 'S3';

export type StudentGender = 'male' | 'female' | 'prefer_not_to_say';

export interface Student {
  id: string;
  orgId: string;
  name: string;
  grade: GradeLevel;
  school: { id: string; name: string; shortName: string | null } | null;
  birthday: string | null;
  gender: StudentGender | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  isActive: boolean;
  parentNames: string[];
  /** 主要家長電話：只有 `/api/students` 列表回、只有管理員有值（#1138），老師是 null */
  primaryParentPhone?: string | null;
  /** 列表、而且有算的時候才有（#1314 SL1）。null = 今天沒有他的課 */
  todayStatus?: { state: StudentTodayState; dueAt: string | null; arrivedAt: string | null } | null;
  /** 列表才有（#1314 SL2）：任一待繳費 → pending_payment；否則在籍 → active；暫停 → suspended；只剩退班 → withdrawal；沒報名 → null */
  enrollmentState?: 'pending_payment' | 'active' | 'suspended' | 'withdrawal' | null;
  campusNames: string[];
  /** 在籍班級名稱，老師端用來分組 */
  classNames: string[];
  hasEnrollments: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudentDetailParent {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  relation: string | null;
  isPrimary: boolean;
}

export interface StudentDetail extends Student {
  parents: StudentDetailParent[];
}

export interface StudentListResponse {
  data: Student[];
  summary: {
    total: number;
    activeCount: number;
    /** 依年級分章（#1314 SL3）：高年級在前（S3→P1，同列表排序）、每級都有；吃列表篩選但不吃 grade */
    byGrade: { grade: GradeLevel; count: number }[];
    /** 今日到班各狀態人數（#1314 SL1）。只套分校範圍；沒算或逐堂點名模式 → null */
    today?: Record<StudentTodayFilter, number> | null;
  };
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

/**
 * 學生檔案的到班格（#1314 SD2）：區間內他有課的每一天一格。
 * 日到班分校看打卡、逐堂分校看出勤紀錄（依班的分校判）；late 當到
 */
export interface StudentAttendanceDays {
  days: {
    date: string;
    state: 'came' | 'absent' | 'on_leave' | 'cancelled' | 'future';
    sessions: { sessionId: string; className: string; startTime: string | null; status: string }[];
  }[];
  /** `due` = 非停課非未來的天數（「到班 came／due 天」） */
  summary: { due: number; came: number; absentDates: string[] };
  today: { startTime: string | null } | null;
  /** 區間內今天之後的第一堂（區間外不找） */
  nextSession: { date: string; startTime: string | null; className: string } | null;
}

/** 今日到班（#1314 SL1）。判準跟作業台同一份（後端 `lib/today-attendance.ts`） */
export type StudentTodayState = 'arrived' | 'on_leave' | 'missing' | 'not_yet';
export type StudentTodayFilter = 'any' | StudentTodayState;

export interface StudentQueryParams {
  search?: string;
  searchScope?: 'default' | 'student_name';
  grade?: GradeLevel;
  campusId?: string;
  page?: number;
  pageSize?: number;
  isActive?: boolean;
  schoolId?: string | null;
  /** 老師端用。實際範圍由後端依角色決定，這個旗標只是意圖 */
  taughtByMe?: boolean;
  /** 今日到班篩選。逐堂點名模式的分校 → 400 `TODAY_UNSUPPORTED_MODE` */
  today?: StudentTodayFilter;
  /** `false` = 不算今日到班（只要總數的呼叫用）。後端預設第一頁才算 */
  withToday?: boolean;
}

export interface UpdateStudentInput {
  name?: string;
  grade?: GradeLevel;
  schoolId?: string | null;
  birthday?: string | null;
  gender?: StudentGender | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export interface CreateStudentInput {
  name: string;
  grade: GradeLevel;
  schoolId?: string | null;
  birthday?: string | null;
  gender?: StudentGender | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  notes?: string | null;
  parentId?: string;
}

export const GRADE_LEVELS: GradeLevel[] = [
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'J1',
  'J2',
  'J3',
  'S1',
  'S2',
  'S3',
];

export const GRADE_LEVEL_LABELS: Record<GradeLevel, string> = {
  P1: '小一',
  P2: '小二',
  P3: '小三',
  P4: '小四',
  P5: '小五',
  P6: '小六',
  J1: '國一',
  J2: '國二',
  J3: '國三',
  S1: '高一',
  S2: '高二',
  S3: '高三',
};

@Injectable({ providedIn: 'root' })
export class StudentsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/students`;

  list(params?: StudentQueryParams): Observable<StudentListResponse> {
    return this.http.get<StudentListResponse>(this.endpoint, {
      params: this.toQueryParams(params),
    });
  }

  create(input: CreateStudentInput): Observable<{ data: Student }> {
    return this.http.post<{ data: Student }>(this.endpoint, input);
  }

  get(id: string): Observable<{ data: StudentDetail }> {
    return this.http.get<{ data: StudentDetail }>(`${this.endpoint}/${id}`);
  }

  /** 學生檔案的到班格（#1314 SD2）。`from`／`to` 必填（`YYYY-MM-DD`，≤ 366 天） */
  attendanceDays(id: string, from: string, to: string): Observable<StudentAttendanceDays> {
    return this.http.get<StudentAttendanceDays>(`${this.endpoint}/${id}/attendance-days`, {
      params: { from, to },
    });
  }

  update(id: string, input: UpdateStudentInput): Observable<{ data: Student }> {
    return this.http.put<{ data: Student }>(`${this.endpoint}/${id}`, input);
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.endpoint}/${id}`);
  }

  private toQueryParams(params?: StudentQueryParams): Record<string, string | number | boolean> {
    if (!params) return {};
    const q: Record<string, string | number | boolean> = {};
    if (params.search !== undefined) q['search'] = params.search;
    if (params.searchScope !== undefined) q['searchScope'] = params.searchScope;
    if (params.grade !== undefined) q['grade'] = params.grade;
    if (params.campusId !== undefined) q['campusId'] = params.campusId;
    if (params.page !== undefined) q['page'] = params.page;
    if (params.pageSize !== undefined) q['pageSize'] = params.pageSize;
    if (params.isActive !== undefined) q['isActive'] = params.isActive;
    if (params.schoolId !== undefined && params.schoolId !== null) q['schoolId'] = params.schoolId;
    if (params.taughtByMe !== undefined) q['taughtByMe'] = params.taughtByMe;
    if (params.today !== undefined) q['today'] = params.today;
    if (params.withToday !== undefined) q['withToday'] = params.withToday;
    return q;
  }
}
