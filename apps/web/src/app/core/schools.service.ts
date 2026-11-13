import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '@env/environment';

/** 學制（#1314 SE4）。null＝未分類 —— 畫面放最後一章 */
export type SchoolLevel = 'elementary' | 'junior' | 'senior';

export interface School {
  readonly id: string;
  readonly name: string;
  readonly shortName: string | null;
  readonly level: SchoolLevel | null;
  readonly isActive: boolean;
  readonly studentCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SchoolListResponse {
  readonly data: School[];
  readonly meta: { total: number };
}

export interface CreateSchoolInput {
  readonly name: string;
  readonly shortName?: string | null;
  readonly level?: SchoolLevel | null;
  readonly isActive?: boolean;
}

export interface UpdateSchoolInput {
  readonly name?: string;
  readonly shortName?: string | null;
  readonly level?: SchoolLevel | null;
  readonly isActive?: boolean;
}

/** 學校行事曆的事件種類（#1160）：開學／休業式／寒假／暑假／補課／停課／其他 */
export type SchoolCalendarKind =
  | 'semester_start'
  | 'semester_end'
  | 'winter_break'
  | 'summer_break'
  | 'makeup_day'
  | 'no_class'
  | 'other';

export interface SchoolCalendarEvent {
  readonly id: string;
  readonly schoolId: string;
  readonly kind: SchoolCalendarKind;
  readonly startDate: string;
  readonly endDate: string;
  readonly note: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 期（billing_periods）的起訖；行事曆 GET 順帶回，只有 manage_courses 也能用期選範圍（#1160 Q6） */
export interface SchoolCalendarPeriod {
  readonly id: string;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
}

export interface SchoolCalendarResponse {
  readonly data: SchoolCalendarEvent[];
  readonly meta: { readonly periods: SchoolCalendarPeriod[] };
}

export interface CreateSchoolCalendarEventInput {
  readonly kind: SchoolCalendarKind;
  readonly startDate: string;
  /** 不給＝單日 */
  readonly endDate?: string;
  readonly note?: string | null;
  /** 同時加到這些學校（#1160 Q2） */
  readonly alsoSchoolIds?: readonly string[];
}

export interface UpdateSchoolCalendarEventInput {
  readonly kind?: SchoolCalendarKind;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly note?: string | null;
}

@Injectable({ providedIn: 'root' })
export class SchoolsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/schools`;

  private readonly _cache = signal<School[]>([]);
  readonly cache = this._cache.asReadonly();

  list(params: { search?: string; isActive?: boolean } = {}): Observable<SchoolListResponse> {
    const q: Record<string, string> = {};
    if (params.search) q['search'] = params.search;
    if (params.isActive !== undefined) q['isActive'] = String(params.isActive);
    return this.http
      .get<SchoolListResponse>(this.base, { params: q })
      .pipe(tap((res) => this._cache.set(res.data)));
  }

  create(input: CreateSchoolInput): Observable<{ data: School }> {
    return this.http.post<{ data: School }>(this.base, input);
  }

  update(id: string, input: UpdateSchoolInput): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.base}/${id}`, input);
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/${id}`);
  }

  /** 某校行事曆：跟 from～to 重疊的事件（都不給＝全部）＋期的起訖 */
  calendarEvents(
    schoolId: string,
    range: { from?: string; to?: string } = {},
  ): Observable<SchoolCalendarResponse> {
    const params: Record<string, string> = {};
    if (range.from) params['from'] = range.from;
    if (range.to) params['to'] = range.to;
    return this.http.get<SchoolCalendarResponse>(`${this.base}/${schoolId}/calendar-events`, {
      params,
    });
  }

  /** 回每所學校各一筆，自己那所在第一筆 */
  createCalendarEvent(
    schoolId: string,
    input: CreateSchoolCalendarEventInput,
  ): Observable<{ data: SchoolCalendarEvent[] }> {
    return this.http.post<{ data: SchoolCalendarEvent[] }>(
      `${this.base}/${schoolId}/calendar-events`,
      input,
    );
  }

  updateCalendarEvent(
    schoolId: string,
    eventId: string,
    input: UpdateSchoolCalendarEventInput,
  ): Observable<{ data: SchoolCalendarEvent }> {
    return this.http.patch<{ data: SchoolCalendarEvent }>(
      `${this.base}/${schoolId}/calendar-events/${eventId}`,
      input,
    );
  }

  deleteCalendarEvent(schoolId: string, eventId: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(
      `${this.base}/${schoolId}/calendar-events/${eventId}`,
    );
  }
}
