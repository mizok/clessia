import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

/**
 * API Service
 *
 * 封裝對 Hono API 的呼叫
 */
@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  /**
   * 健康檢查
   */
  health(): Observable<{ healthy: boolean; timestamp: string }> {
    return this.http.get<{ healthy: boolean; timestamp: string }>(`${this.baseUrl}/health`);
  }

  /**
   * 取得當前使用者資訊（需要登入）
   */
  getMe(): Observable<{ id: string; email: string; createdAt: string }> {
    return this.http.get<{ id: string; email: string; createdAt: string }>(
      `${this.baseUrl}/api/me`
    );
  }
}
