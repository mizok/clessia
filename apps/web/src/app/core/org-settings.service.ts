import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type AttendanceMode = 'per_session' | 'daily_checkin';
export type AttendanceResponsible = 'admin' | 'teacher';

export interface OrgSettings {
  id: string;
  name: string;
  attendanceMode: AttendanceMode;
  attendanceResponsible: AttendanceResponsible;
  attendanceRetroactiveDays: number;
  /** 開帳時 due_date 的預設天數（kb/wiki/rules/billing-rules.md 規則 7） */
  invoiceDueDays: number;
}

export interface UpdateOrgSettingsInput {
  attendanceMode?: AttendanceMode;
  attendanceResponsible?: AttendanceResponsible;
  attendanceRetroactiveDays?: number;
  invoiceDueDays?: number;
}

@Injectable({ providedIn: 'root' })
export class OrgSettingsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/api/org`;

  readonly settings = signal<OrgSettings | null>(null);

  getSettings(): Observable<OrgSettings> {
    return this.http.get<OrgSettings>(`${this.baseUrl}/settings`);
  }

  updateSettings(input: UpdateOrgSettingsInput): Observable<OrgSettings> {
    return this.http.patch<OrgSettings>(`${this.baseUrl}/settings`, input);
  }
}
