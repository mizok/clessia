import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type SchoolExamType = 'term_exam' | 'mock_exam' | 'other';
export type SchoolExamStatus = 'active' | 'closed';
export type SchoolScoreStatus = 'scored' | 'absent' | 'makeup';

const SCHOOL_EXAM_TYPE_LABELS: Record<SchoolExamType, string> = {
  term_exam: '段考',
  mock_exam: '模擬考',
  other: '其他',
};

export function schoolExamTypeLabel(examType: SchoolExamType): string {
  return SCHOOL_EXAM_TYPE_LABELS[examType];
}

export interface SchoolExam {
  id: string;
  academicYear: number;
  semester: 1 | 2;
  examType: SchoolExamType;
  name: string | null;
  label: string;
  examDate: string | null;
  status: SchoolExamStatus;
  schoolId: string;
  schoolName: string;
  scoreCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SchoolSubjectSummary {
  subjectId: string;
  subjectName: string;
  averageScore: number | null;
  recordedCount: number;
}

export interface SchoolExamDetail {
  id: string;
  academicYear: number;
  semester: 1 | 2;
  examType: SchoolExamType;
  name: string | null;
  label: string;
  examDate: string | null;
  status: SchoolExamStatus;
  schoolId: string;
  schoolName: string;
  summary: {
    bySubject: SchoolSubjectSummary[];
    totalRecordedCount: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface SchoolScore {
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  subjectId: string;
  subjectName: string;
  score: number | null;
  status: SchoolScoreStatus;
  notes: string | null;
  updatedAt: string;
}

export interface StudentSchoolScore {
  schoolExamId: string;
  label: string;
  academicYear: number;
  semester: 1 | 2;
  examType: SchoolExamType;
  name: string | null;
  subjectId: string;
  subjectName: string;
  score: number | null;
  status: SchoolScoreStatus;
  notes: string | null;
  updatedAt: string;
}

export interface SchoolExamListParams {
  academicYear?: number;
  semester?: 1 | 2;
  page?: number;
  pageSize?: number;
}

export interface SchoolExamListResponse {
  data: SchoolExam[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
  };
}

export interface CreateSchoolExamInput {
  academicYear: number;
  semester: 1 | 2;
  examType: SchoolExamType;
  name?: string | null;
  schoolId: string;
  examDate?: string | null;
}

export interface UpdateSchoolExamInput {
  academicYear?: number;
  semester?: 1 | 2;
  examType?: SchoolExamType;
  name?: string | null;
  schoolId?: string;
  examDate?: string | null;
}

export interface RecentStudent {
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  scoreCount: number;
  lastUpdatedAt: string;
}

export type SchoolExamStudentStatus = 'all' | 'pending' | 'scored' | 'absent' | 'makeup';

export interface SchoolExamStudent {
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

export interface SchoolExamStudentListParams {
  campusId?: string;
  status?: SchoolExamStudentStatus;
  search?: string;
  grade?: string;
  page?: number;
  pageSize?: number;
}

export interface SchoolExamStudentListResponse {
  data: SchoolExamStudent[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
  };
}

export interface SaveSchoolScoresInput {
  studentId: string;
  subjectId: string;
  score: number | null;
  status: SchoolScoreStatus;
  notes?: string | null;
}

@Injectable({ providedIn: 'root' })
export class SchoolExamsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/school-exams`;

  list(params?: SchoolExamListParams): Observable<SchoolExamListResponse> {
    return this.http.get<SchoolExamListResponse>(this.base, {
      params: this.toQueryParams(params),
    });
  }

  get(
    id: string,
    params?: { campusId?: string; grade?: string },
  ): Observable<{ data: SchoolExamDetail }> {
    const query: Record<string, string> = {};
    if (params?.campusId) query['campusId'] = params.campusId;
    if (params?.grade) query['grade'] = params.grade;
    return this.http.get<{ data: SchoolExamDetail }>(`${this.base}/${id}`, { params: query });
  }

  create(data: CreateSchoolExamInput): Observable<{ data: { id: string; label: string } }> {
    return this.http.post<{ data: { id: string; label: string } }>(this.base, data);
  }

  update(id: string, data: UpdateSchoolExamInput): Observable<{ success: boolean; label: string }> {
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

  getScores(examId: string, studentId?: string): Observable<{ data: SchoolScore[] }> {
    const params: Record<string, string> = {};
    if (studentId) params['studentId'] = studentId;
    return this.http.get<{ data: SchoolScore[] }>(`${this.base}/${examId}/scores`, { params });
  }

  getRecentStudents(examId: string): Observable<{ data: RecentStudent[] }> {
    return this.http.get<{ data: RecentStudent[] }>(`${this.base}/${examId}/recent-students`);
  }

  getStudents(
    examId: string,
    params?: SchoolExamStudentListParams,
  ): Observable<SchoolExamStudentListResponse> {
    const query: Record<string, string | number | boolean> = {};
    if (params?.campusId) query['campusId'] = params.campusId;
    if (params?.status && params.status !== 'all') query['status'] = params.status;
    if (params?.search) query['search'] = params.search;
    if (params?.grade) query['grade'] = params.grade;
    if (params?.page) query['page'] = params.page;
    if (params?.pageSize) query['pageSize'] = params.pageSize;
    return this.http.get<SchoolExamStudentListResponse>(`${this.base}/${examId}/students`, {
      params: query,
    });
  }

  saveScores(
    examId: string,
    scores: SaveSchoolScoresInput[],
  ): Observable<{ success: boolean; affected: number }> {
    return this.http.post<{ success: boolean; affected: number }>(`${this.base}/${examId}/scores`, {
      scores,
    });
  }

  getByStudent(studentId: string): Observable<{ data: StudentSchoolScore[] }> {
    return this.http.get<{ data: StudentSchoolScore[] }>(`${this.base}/by-student/${studentId}`);
  }

  private toQueryParams(params?: SchoolExamListParams): Record<string, string | number | boolean> {
    if (!params) return {};

    const query: Record<string, string | number | boolean> = {};
    if (params.academicYear !== undefined) query['academic_year'] = params.academicYear;
    if (params.semester !== undefined) query['semester'] = params.semester;
    if (params.page !== undefined) query['page'] = params.page;
    if (params.pageSize !== undefined) query['pageSize'] = params.pageSize;

    return query;
  }
}
