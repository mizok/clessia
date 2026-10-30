import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type ScoreRecordType = 'academy' | 'school';
export type ScoreRecordStatus = 'scored' | 'absent' | 'makeup';

export interface ScoreRecord {
  id: string;
  type: ScoreRecordType;
  examName: string;
  examDate: string;
  studentId: string;
  studentName: string;
  subjectName: string | null;
  score: number | null;
  totalScore: number | null;
  status: ScoreRecordStatus;
  examId: string;
  /** 這場（校內考）scored 成績的平均，1 位小數（#1314 G10）。母體＝整場應考者；段考或他沒分數 → null */
  classAvg: number | null;
  /** 名次：1＋分數比他高的人數（同分同名次） */
  rank: number | null;
  classSize: number | null;
}

export interface ScoreListParams {
  studentId?: string;
  type?: ScoreRecordType;
  subjectId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ScoreListResponse {
  data: ScoreRecord[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
  };
}

export interface SubjectAverage {
  subjectName: string;
  academySum: number | null;
  academyTotalSum: number | null;
  schoolAvg: number | null;
  totalRecords: number;
}

export interface StudentSummary {
  studentId: string;
  studentName: string;
  subjects: SubjectAverage[];
  /** 最近一場有分數的校內考（#1314 SD4「最近 82 分（班平均 76）」）。沒有 → null */
  latestAcademy: {
    examId: string;
    examName: string;
    examDate: string;
    score: number;
    totalScore: number | null;
    classAvg: number | null;
    rank: number | null;
    classSize: number | null;
  } | null;
}

export interface ClassExamScore {
  studentId: string;
  studentName: string;
  score: number | null;
  /** `pending`＝這場還沒登錄（#1280）。只有班級考試名單會有，成績列表不會 */
  status: ScoreRecordStatus | 'pending';
  notes: string | null;
}

export interface ClassExamSummary {
  averageScore: number | null;
  highestScore: number | null;
  lowestScore: number | null;
  absentCount: number;
  recordedCount: number;
}

export interface ClassExamStats {
  examId: string;
  examName: string;
  className: string;
  summary: ClassExamSummary;
  scores: ClassExamScore[];
}

/** 單場列：`avgScore` 是該場自己的尺度（配 `totalScore`），只含 scored */
export interface OverviewExamRow {
  examId: string;
  examName: string;
  examDate: string;
  totalScore: number;
  avgScore: number | null;
  failCount: number;
  absentCount: number;
}

/** `GET /scores/overview`（#1314 G5）：近 `days` 天（台北日）的校內考 */
export interface ScoresOverview {
  windowDays: number;
  /** `avgScore` 換算成 100 分制 */
  exams: { count: number; pendingCount: number; avgScore: number | null };
  /** 每生最近一場不及格，依得分率升冪前 5；`grade` 是 enum，標籤用 `GRADE_LEVEL_LABELS`（students.service）轉 */
  failingStudents: Array<{
    studentId: string;
    name: string;
    grade: string | null;
    className: string | null;
    examName: string;
    examDate: string;
    score: number;
    totalScore: number;
  }>;
  failingTotal: number;
  /** 每班最近一場，依得分率升冪前 3 */
  lowestClasses: Array<OverviewExamRow & { classId: string; className: string }>;
  totalClasses: number;
  /** 一場一列（多班名以「、」接），考試日降冪上限 50 */
  recentExams: Array<OverviewExamRow & { className: string; missingCount: number }>;
}

/** `GET /scores/students` 的一列（每生聚合）。校內考是總得分／總滿分，段考是平均 */
export interface StudentScoreAggregate {
  studentId: string;
  studentName: string;
  academySum: number | null;
  academyTotalSum: number | null;
  schoolAvg: number | null;
  scoredCount: number;
  absentCount: number;
  makeupCount: number;
  latestExamDate: string | null;
  /** grade_level enum（P1…S3），標籤用 `GRADE_LEVEL_LABELS`（students.service） */
  grade: string | null;
  /** 最近一場有分數的校內考（#1314 G8）；段考沒有總分，不算 */
  latest: {
    score: number;
    totalScore: number;
    examName: string;
    examDate: string;
    failing: boolean;
  } | null;
  /** 最近一場減上一場（校內考），換算 100 分制的差；少於兩場 null */
  deltaVsPrev: number | null;
  /** 近 30 天（台北日）缺考次數，校內考＋段考；`absentCount` 是查詢範圍內全部 */
  recentAbsentCount: number;
}

@Injectable({ providedIn: 'root' })
export class ScoresService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/scores`;

  list(params?: ScoreListParams): Observable<ScoreListResponse> {
    return this.http.get<ScoreListResponse>(this.base, {
      params: this.toQueryParams(params),
    });
  }

  getStudentSummary(studentId: string): Observable<{ data: StudentSummary }> {
    return this.http.get<{ data: StudentSummary }>(`${this.base}/student/${studentId}/summary`);
  }

  getClassExamStats(classId: string, examId: string): Observable<{ data: ClassExamStats }> {
    return this.http.get<{ data: ClassExamStats }>(`${this.base}/class/${classId}/exam/${examId}`);
  }

  overview(params?: { days?: number; campusId?: string }): Observable<ScoresOverview> {
    const query: Record<string, string | number> = {};
    if (params?.days !== undefined) query['days'] = params.days;
    if (params?.campusId) query['campusId'] = params.campusId;
    return this.http.get<ScoresOverview>(`${this.base}/overview`, { params: query });
  }

  /**
   * 全部學生的每生聚合（#1314 G8，`scope=all`）。可見範圍同 `/students` 列表；
   * 只能搭 `campusId` 與分頁（帶別的參數 API 回 400）。只列有成績的學生
   */
  studentAggregatesAll(params?: {
    campusId?: string;
    /** `grade`＝年級（P1→S3）再依姓名；預設依姓名 */
    sort?: 'name' | 'grade';
    page?: number;
    pageSize?: number;
  }): Observable<{
    data: StudentScoreAggregate[];
    meta: { total: number; page: number; pageSize: number };
  }> {
    const query: Record<string, string | number> = { scope: 'all' };
    if (params?.campusId) query['campusId'] = params.campusId;
    if (params?.sort) query['sort'] = params.sort;
    if (params?.page !== undefined) query['page'] = params.page;
    if (params?.pageSize !== undefined) query['pageSize'] = params.pageSize;
    return this.http.get<{
      data: StudentScoreAggregate[];
      meta: { total: number; page: number; pageSize: number };
    }>(`${this.base}/students`, { params: query });
  }

  /** 一門課程的每生聚合（#1314 G9）：只列這門課開課班裡有成績的學生；不能搭 `campusId` */
  studentAggregatesByCourse(params: {
    courseId: string;
    page?: number;
    pageSize?: number;
  }): Observable<{
    data: StudentScoreAggregate[];
    meta: { total: number; page: number; pageSize: number };
  }> {
    const query: Record<string, string | number> = { courseId: params.courseId };
    if (params.page !== undefined) query['page'] = params.page;
    if (params.pageSize !== undefined) query['pageSize'] = params.pageSize;
    return this.http.get<{
      data: StudentScoreAggregate[];
      meta: { total: number; page: number; pageSize: number };
    }>(`${this.base}/students`, { params: query });
  }

  /**
   * 成績匯出 CSV（#1100 #40）。範圍由後端決定（老師範圍 ∩ 分校範圍 ∩ 這裡帶的學生），
   * 帶了範圍外的學生也撈不到。拿 **blob**：後端給 Excel 的 UTF-8 BOM 用 text 解會被吃掉。
   * 超過上限回 413，錯誤本體是 JSON blob。
   */
  exportCsv(body: { studentIds?: string[]; campusId?: string }): Observable<Blob> {
    return this.http.post(`${this.base}/export`, body, { responseType: 'blob' });
  }

  private toQueryParams(params?: ScoreListParams): Record<string, string | number | boolean> {
    if (!params) return {};

    const query: Record<string, string | number | boolean> = {};
    if (params.studentId !== undefined) query['studentId'] = params.studentId;
    if (params.type !== undefined) query['type'] = params.type;
    if (params.subjectId !== undefined) query['subjectId'] = params.subjectId;
    if (params.dateFrom !== undefined) query['dateFrom'] = params.dateFrom;
    if (params.dateTo !== undefined) query['dateTo'] = params.dateTo;
    if (params.search !== undefined) query['search'] = params.search;
    if (params.page !== undefined) query['page'] = params.page;
    if (params.pageSize !== undefined) query['pageSize'] = params.pageSize;

    return query;
  }
}
