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

export interface TermExamSchedule {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly examDate: string | null;
}

export interface TermExamDetail {
  id: string;
  academicYear: number;
  semester: 1 | 2;
  period: TermExamPeriod;
  label: string;
  examDate: string | null;
  readonly schedules: TermExamSchedule[];
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
  schedules?: Array<{ schoolId: string; examDate: string | null }>;
}

export interface UpdateTermExamInput {
  academicYear?: number;
  semester?: 1 | 2;
  period?: TermExamPeriod;
  examDate?: string | null;
  schedules?: Array<{ schoolId: string; examDate: string | null }>;
}

export interface RecentStudent {
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  scoreCount: number;
  lastUpdatedAt: string;
}

export type TermExamStudentStatus = 'all' | 'pending' | 'scored' | 'absent' | 'makeup';

export interface TermExamStudent {
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  campusNames: string[];
  scoreCount: number;
  subjectCount: number;
  hasScored: boolean;
  hasAbsent: boolean;
  hasMakeup: boolean;
  lastUpdatedAt: string | null;
}

export interface TermExamStudentListParams {
  campusId?: string;
  status?: TermExamStudentStatus;
  search?: string;
  grade?: string;
  page?: number;
  pageSize?: number;
}

export interface TermExamStudentListResponse {
  data: TermExamStudent[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
  };
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

  get(
    id: string,
    params?: { campusId?: string; grade?: string },
  ): Observable<{ data: TermExamDetail }> {
    const query: Record<string, string> = {};
    if (params?.campusId) query['campusId'] = params.campusId;
    if (params?.grade) query['grade'] = params.grade;
    return this.http.get<{ data: TermExamDetail }>(`${this.base}/${id}`, { params: query });
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

  getStudents(
    examId: string,
    params?: TermExamStudentListParams,
  ): Observable<TermExamStudentListResponse> {
    const query: Record<string, string | number | boolean> = {};
    if (params?.campusId) query['campusId'] = params.campusId;
    if (params?.status && params.status !== 'all') query['status'] = params.status;
    if (params?.search) query['search'] = params.search;
    if (params?.grade) query['grade'] = params.grade;
    if (params?.page) query['page'] = params.page;
    if (params?.pageSize) query['pageSize'] = params.pageSize;
    return this.http.get<TermExamStudentListResponse>(`${this.base}/${examId}/students`, {
      params: query,
    });
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
