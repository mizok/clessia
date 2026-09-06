import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type AttendanceMode = 'per_session' | 'daily_checkin';
export type AttendanceResponsible = 'admin' | 'teacher';

/**
 * 設定的載入狀態。
 *
 * **存在的理由**：`settings` 是 `OrgSettings | null`，而消費端普遍寫成
 * `settings()?.attendanceResponsible ?? 'admin'` —— 那個 `??` 把
 * 「**還沒載到**」跟「**真的是 admin 負責**」壓成同一個答案。壓掉之後畫面
 * 沒有任何差別：老師端的逾期警示整批消失，跟「這週都點完了」一模一樣（#484 H2）。
 *
 * **預設值本身沒有錯**（保守、不誤責老師）；錯的是兩個狀態共用一個值。
 */
export type OrgSettingsStatus = 'unloaded' | 'ready' | 'failed';

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

  /** 見 `OrgSettingsStatus`：把「還沒載到／載入失敗」跟設定的內容分開 */
  readonly status = signal<OrgSettingsStatus>('unloaded');

  /**
   * 載入設定並記錄結果。
   *
   * 呼叫端原本各自寫 `getSettings().subscribe({ next })` —— **沒有 error 分支**，
   * 失敗時連拋到哪裡都沒有人接，而 `settings` 留在 `null`。
   * 這支把「載入」跟「記錄載入結果」綁在一起，呼叫端就不會只實作一半。
   */
  load(): void {
    this.getSettings().subscribe({
      next: (s) => {
        this.settings.set(s);
        this.status.set('ready');
      },
      error: () => this.status.set('failed'),
    });
  }

  getSettings(): Observable<OrgSettings> {
    return this.http.get<OrgSettings>(`${this.baseUrl}/settings`);
  }

  updateSettings(input: UpdateOrgSettingsInput): Observable<OrgSettings> {
    return this.http.patch<OrgSettings>(`${this.baseUrl}/settings`, input);
  }
}
