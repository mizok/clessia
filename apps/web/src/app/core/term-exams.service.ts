import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type TermExamPeriod = 'midterm_1' | 'final_1' | 'midterm_2' | 'final_2';
export type TermExamStatus = 'active' | 'closed';
export type TermScoreStatus = 'scored' | 'absent' | 'makeup';

export interface TermExam {
  id: string;
  academicYear: number;
  semester: 1 | 2;
  period: TermExamPeriod;
  label: string;
  examDate: string | null;
  status: TermExamStatus;
  scoreCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TermSubjectSummary {
  subjectId: string;
  subjectName: string;
  averageScore: number | null;
  recordedCount: number;
}

export interface TermExamDetail {
  id: string;
  academicYear: number;
  semester: 1 | 2;
  period: TermExamPeriod;
  label: string;
  examDate: string | null;
  status: TermExamStatus;
  summary: {
    bySubject: TermSubjectSummary[];
    totalRecordedCount: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface TermScore {
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  subjectId: string;
  subjectName: string;
  score: number | null;
  status: TermScoreStatus;
  notes: string | null;
  updatedAt: string;
}

export interface StudentTermScore {
  termExamId: string;
  label: string;
  academicYear: number;
  semester: 1 | 2;
  period: TermExamPeriod;
  subjectId: string;
  subjectName: string;
  score: number | null;
  status: TermScoreStatus;
  notes: string | null;
  updatedAt: string;
}

export interface TermExamListParams {
  academicYear?: number;
  semester?: 1 | 2;
  page?: number;
  pageSize?: number;
}

export interface TermExamListResponse {
  data: TermExam[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
  };
}

export interface CreateTermExamInput {
  academicYear: number;
  semester: 1 | 2;
  period: TermExamPeriod;
  examDate?: string;
}

export interface UpdateTermExamInput {
  academicYear?: number;
  semester?: 1 | 2;
  period?: TermExamPeriod;
  examDate?: string | null;
}

export interface RecentStudent {
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  scoreCount: number;
  lastUpdatedAt: string;
}

export interface SaveTermScoresInput {
  studentId: string;
  subjectId: string;
  score: number | null;
  status: TermScoreStatus;
  notes?: string | null;
}

@Injectable({ providedIn: 'root' })
export class TermExamsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/term-exams`;

  list(params?: TermExamListParams): Observable<TermExamListResponse> {
    return this.http.get<TermExamListResponse>(this.base, {
      params: this.toQueryParams(params),
    });
  }

  get(id: string): Observable<{ data: TermExamDetail }> {
    return this.http.get<{ data: TermExamDetail }>(`${this.base}/${id}`);
  }

  create(data: CreateTermExamInput): Observable<{ data: { id: string; label: string } }> {
    return this.http.post<{ data: { id: string; label: string } }>(this.base, data);
  }

  update(id: string, data: UpdateTermExamInput): Observable<{ success: boolean; label: string }> {
    return this.http.put<{ success: boolean; label: string }>(`${this.base}/${id}`, data);
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

  getScores(examId: string, studentId?: string): Observable<{ data: TermScore[] }> {
    const params: Record<string, string> = {};
    if (studentId) params['studentId'] = studentId;
    return this.http.get<{ data: TermScore[] }>(`${this.base}/${examId}/scores`, { params });
  }

  getRecentStudents(examId: string): Observable<{ data: RecentStudent[] }> {
    return this.http.get<{ data: RecentStudent[] }>(`${this.base}/${examId}/recent-students`);
  }

  saveScores(
    examId: string,
    scores: SaveTermScoresInput[],
  ): Observable<{ success: boolean; affected: number }> {
    return this.http.post<{ success: boolean; affected: number }>(`${this.base}/${examId}/scores`, {
      scores,
    });
  }

  getByStudent(studentId: string): Observable<{ data: StudentTermScore[] }> {
    return this.http.get<{ data: StudentTermScore[] }>(`${this.base}/by-student/${studentId}`);
  }

  private toQueryParams(params?: TermExamListParams): Record<string, string | number | boolean> {
    if (!params) return {};

    const query: Record<string, string | number | boolean> = {};
    if (params.academicYear !== undefined) query['academic_year'] = params.academicYear;
    if (params.semester !== undefined) query['semester'] = params.semester;
    if (params.page !== undefined) query['page'] = params.page;
    if (params.pageSize !== undefined) query['pageSize'] = params.pageSize;

    return query;
  }
}
