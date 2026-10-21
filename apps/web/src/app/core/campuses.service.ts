import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export interface Campus {
  id: string;
  orgId: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  /** 帳戶資訊覆寫（#1073）。null = 沿用機構預設 */
  paymentInfo: string | null;
  /** 出勤模式（#1112）。null = 沿用機構預設（`OrgSettings.attendanceMode`） */
  attendanceMode: 'per_session' | 'daily_checkin' | null;
  createdAt: string;
  updatedAt: string;
}

/** 分校的教室（#1314 SE3） */
export interface Classroom {
  id: string;
  campusId: string;
  name: string;
  /** 只顯示，不擋班級人數上限；null = 沒填 */
  capacity: number | null;
  equipment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClassroomInput {
  name: string;
  capacity?: number | null;
  equipment?: string | null;
}

export interface CampusListResponse {
  /** 列表才帶 `classroomCount`（列上的「N 間教室」） */
  data: Array<Campus & { classroomCount: number }>;
  summary: {
    total: number;
    activeCount: number;
    inactiveCount: number;
  };
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface CampusQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  isActive?: boolean;
}

export interface CreateCampusInput {
  name: string;
  address?: string | null;
  phone?: string | null;
  isActive?: boolean;
}

export interface UpdateCampusInput {
  name?: string;
  address?: string | null;
  phone?: string | null;
  isActive?: boolean;
  /** null = 改回沿用機構預設。要 `manage_org_settings`，沒有的人不要送這個 key */
  attendanceMode?: 'per_session' | 'daily_checkin' | null;
  /** null／空白 = 改回沿用機構預設。要 `manage_finance`，沒有的人不要送這個 key */
  paymentInfo?: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class CampusesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;
  private readonly endpoint = `${this.baseUrl}/api/campuses`;

  list(params?: CampusQueryParams): Observable<CampusListResponse> {
    return this.http.get<CampusListResponse>(this.endpoint, {
      params: this.toListParams(params),
    });
  }

  get(id: string): Observable<{ data: Campus }> {
    return this.http.get<{ data: Campus }>(`${this.endpoint}/${id}`);
  }

  create(input: CreateCampusInput): Observable<{ data: Campus }> {
    return this.http.post<{ data: Campus }>(this.endpoint, input);
  }

  update(id: string, input: UpdateCampusInput): Observable<{ data: Campus }> {
    return this.http.put<{ data: Campus }>(`${this.endpoint}/${id}`, input);
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.endpoint}/${id}`);
  }

  listClassrooms(campusId: string): Observable<{ data: Classroom[] }> {
    return this.http.get<{ data: Classroom[] }>(`${this.endpoint}/${campusId}/classrooms`);
  }

  createClassroom(campusId: string, input: ClassroomInput): Observable<{ data: Classroom }> {
    return this.http.post<{ data: Classroom }>(`${this.endpoint}/${campusId}/classrooms`, input);
  }

  updateClassroom(
    campusId: string,
    roomId: string,
    input: ClassroomInput,
  ): Observable<{ data: Classroom }> {
    return this.http.put<{ data: Classroom }>(
      `${this.endpoint}/${campusId}/classrooms/${roomId}`,
      input,
    );
  }

  /** `affectedSchedules`：指定這間教室、改回「不指定」的時段數 */
  deleteClassroom(
    campusId: string,
    roomId: string,
  ): Observable<{ success: boolean; affectedSchedules: number }> {
    return this.http.delete<{ success: boolean; affectedSchedules: number }>(
      `${this.endpoint}/${campusId}/classrooms/${roomId}`,
    );
  }

  private toListParams(params?: CampusQueryParams): Record<string, string | number | boolean> {
    if (!params) {
      return {};
    }

    const query: Record<string, string | number | boolean> = {};

    if (params.page !== undefined) {
      query['page'] = params.page;
    }

    if (params.pageSize !== undefined) {
      query['pageSize'] = params.pageSize;
    }

    if (params.search !== undefined) {
      query['search'] = params.search;
    }

    if (params.isActive !== undefined) {
      query['isActive'] = params.isActive;
    }

    return query;
  }
}
