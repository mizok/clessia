import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type AcademyExamStatus = 'active' | 'closed';
export type AcademyExamType = 'quiz' | 'mock_exam' | 'placement_test';
export type AcademyScoreStatus = 'scored' | 'absent' | 'makeup';

export interface AcademyExam {
  id: string;
  name: string;
  examType: AcademyExamType;
  status: AcademyExamStatus;
  examDate: string;
  totalScore: number;
  passScore: number | null;
  scopeNote: string | null;
  campusId: string | null;
  subjectId: string | null;
  subjectName: string | null;
  classCount: number;
  scoreCount: number;
  // 應登錄人數（分母）= 考試日在籍 ∪ 已登錄。0 代表「沒有人要考」，不是「還沒算」。
  // 定義見 apps/api/src/lib/academy-exam-roster.ts（issue #424 使用者裁定）
  expectedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AcademyExamDetailClass {
  classId: string;
  className: string;
  campusName: string | null;
  courseName: string | null;
}

export interface AcademyExamDetailSummary {
  averageScore: number | null;
  highestScore: number | null;
  lowestScore: number | null;
  absentCount: number;
  recordedCount: number;
}

export interface AcademyExamDetail {
  id: string;
  name: string;
  examType: AcademyExamType;
  status: AcademyExamStatus;
  examDate: string;
  totalScore: number;
  passScore: number | null;
  scopeNote: string | null;
  campusId: string | null;
  campusName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  classes: AcademyExamDetailClass[];
  summary: AcademyExamDetailSummary;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AcademyScore {
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  score: number | null;
  status: AcademyScoreStatus;
  notes: string | null;
  updatedAt: string;
  /** 這名學生在本場考試中所屬的班級。可能多於一個（跨班報名）。 */
  classIds: string[];
}

export interface AcademyExamListParams {
  search?: string;
  status?: AcademyExamStatus;
  campusId?: string;
  subjectId?: string;
  classId?: string;
  dateFrom?: string;
  dateTo?: string;
  todo?: boolean;
  // `todo` 現在的語意是「還沒登完」（N < M）。`todoLevel` 再切兩級：
  // `none` = 一筆都沒有（高）、`partial` = 登到一半（低）
  todoLevel?: 'none' | 'partial';
  order?: 'date_asc' | 'date_desc';
  page?: number;
  pageSize?: number;
}

export interface AcademyExamListResponse {
  data: AcademyExam[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
  };
}

export interface ExamTodoCountResponse {
  /** `none + partial` —— 還沒登完的場次總數 */
  count: number;
  /** 一筆都沒有（高） */
  none: number;
  /** 登到一半（低）。school 沒有這一級，因為它沒有分母 */
  partial: number;
}

export interface CreateAcademyExamInput {
  name: string;
  examType: AcademyExamType;
  subjectId?: string | null;
  campusId?: string | null;
  examDate: string;
  totalScore?: number;
  passScore?: number | null;
  scopeNote?: string | null;
  classIds: string[];
}

export interface UpdateAcademyExamInput {
  name?: string;
  examType?: AcademyExamType;
  subjectId?: string | null;
  campusId?: string | null;
  examDate?: string;
  totalScore?: number;
  passScore?: number | null;
  scopeNote?: string | null;
  classIds?: string[];
}

export interface SaveAcademyScoresInput {
  studentId: string;
  score: number | null;
  status: AcademyScoreStatus;
  notes?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AcademyExamsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/academy-exams`;

  list(params?: AcademyExamListParams): Observable<AcademyExamListResponse> {
    return this.http.get<AcademyExamListResponse>(this.base, {
      params: this.toQueryParams(params),
    });
  }

  getTodoCount(): Observable<ExamTodoCountResponse> {
    return this.http.get<ExamTodoCountResponse>(`${this.base}/todo-count`);
  }

  get(id: string): Observable<{ data: AcademyExamDetail }> {
    return this.http.get<{ data: AcademyExamDetail }>(`${this.base}/${id}`);
  }

  create(data: CreateAcademyExamInput): Observable<{ data: { id: string } }> {
    return this.http.post<{ data: { id: string } }>(this.base, data);
  }

  update(id: string, data: UpdateAcademyExamInput): Observable<{ success: boolean }> {
    return this.http.put<{ success: boolean }>(`${this.base}/${id}`, data);
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/${id}`);
  }

  close(id: string): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.base}/${id}/close`, {});
  }

  reopen(id: string): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.base}/${id}/reopen`, {});
  }

  getScores(examId: string): Observable<{ data: AcademyScore[] }> {
    return this.http.get<{ data: AcademyScore[] }>(`${this.base}/${examId}/scores`);
  }

  saveScores(
    examId: string,
    scores: SaveAcademyScoresInput[],
  ): Observable<{ success: boolean; affected: number }> {
    return this.http.post<{ success: boolean; affected: number }>(`${this.base}/${examId}/scores`, {
      scores,
    });
  }

  private toQueryParams(params?: AcademyExamListParams): Record<string, string | number | boolean> {
    if (!params) return {};

    const query: Record<string, string | number | boolean> = {};
    if (params.search !== undefined) query['search'] = params.search;
    if (params.status !== undefined) query['status'] = params.status;
    if (params.campusId !== undefined) query['campus_id'] = params.campusId;
    if (params.subjectId !== undefined) query['subject_id'] = params.subjectId;
    if (params.classId !== undefined) query['class_id'] = params.classId;
    if (params.dateFrom !== undefined) query['date_from'] = params.dateFrom;
    if (params.dateTo !== undefined) query['date_to'] = params.dateTo;
    if (params.todo !== undefined) query['todo'] = params.todo;
    if (params.todoLevel !== undefined) query['todoLevel'] = params.todoLevel;
    if (params.order !== undefined) query['order'] = params.order;
    if (params.page !== undefined) query['page'] = params.page;
    if (params.pageSize !== undefined) query['pageSize'] = params.pageSize;

    return query;
  }
}
