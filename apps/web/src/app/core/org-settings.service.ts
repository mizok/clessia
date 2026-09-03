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
  // 下面三個是**財務設定，只有帶 `manage_finance` 的請求拿得到** ——
  // 沒有那個權限時 API 回的物件裡根本沒有這幾個 key（不是 0，也不是 null）。
  // 所以型別上是 optional，不要在 UI 裡假設它們一定在。
  /** 開帳時 due_date 的預設天數（kb/wiki/rules/billing-rules.md 規則 7） */
  invoiceDueDays?: number;
  /** 餐費預設單價（單價實際存在每一筆餐記錄上） */
  mealDefaultPrice?: number;
  /** 插班／退班比例試算的基準，預設 days */
  prorationBasis?: 'days' | 'sessions';
}

export interface UpdateOrgSettingsInput {
  attendanceMode?: AttendanceMode;
  attendanceResponsible?: AttendanceResponsible;
  attendanceRetroactiveDays?: number;
  invoiceDueDays?: number;
  mealDefaultPrice?: number;
  prorationBasis?: 'days' | 'sessions';
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
