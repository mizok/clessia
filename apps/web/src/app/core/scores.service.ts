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
