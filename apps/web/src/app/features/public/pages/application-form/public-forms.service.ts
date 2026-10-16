import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '@env/environment';
import { firstValueFrom } from 'rxjs';

import type { FormKind, PublicCatalog } from './application-form.model';

/** `GET /api/public/captcha`：部署設定決定用哪一家（`CAPTCHA_PROVIDER`，預設 ALTCHA，#1665 Q4′） */
export type CaptchaConfig =
  | { provider: 'altcha'; challenge: { parameters: Record<string, unknown>; signature?: string } }
  | { provider: 'turnstile'; siteKey: string };

/** 公開表單的匿名 API（`/api/public/*`）。沒有登入態，所以不經 AuthService */
@Injectable({ providedIn: 'root' })
export class PublicFormsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/public`;

  catalog(): Promise<PublicCatalog> {
    return firstValueFrom(this.http.get<PublicCatalog>(`${this.base}/catalog`));
  }

  captcha(): Promise<CaptchaConfig> {
    return firstValueFrom(this.http.get<CaptchaConfig>(`${this.base}/captcha`));
  }

  submit(kind: FormKind, body: unknown): Promise<{ id: string; waitlistClassIds?: string[] }> {
    const path = kind === 'trial' ? 'trial-applications' : 'enrollment-applications';
    return firstValueFrom(
      this.http.post<{ id: string; waitlistClassIds?: string[] }>(`${this.base}/${path}`, body),
    );
  }

  /**
   * 解 ALTCHA 題目，回 widget 同格式的 payload：base64(JSON `{ challenge, solution }`) ——
   * API 端（`application-common.ts` 的 verifyAltchaPayload）照這個格式拆。
   *
   * 只用 `altcha/lib` 的解題函式、不掛 `<altcha-widget>`：A6 只畫一列「已通過機器人驗證」，
   * 不要 widget 自己的勾選框與文案。lazy import，不進主 bundle。
   * PBKDF2 走 WebCrypto（瀏覽器在背景執行），主執行緒只跑迴圈，表單照常可以輸入。
   */
  async solveAltcha(challenge: Extract<CaptchaConfig, { provider: 'altcha' }>['challenge']) {
    const { solveChallenge, pbkdf2 } = await import('altcha/lib');
    const typed = challenge as unknown as Parameters<typeof solveChallenge>[0]['challenge'];
    // 逾時（預設 90 秒太久）回 null → 丟錯，畫面顯示「重試驗證」
    const solution = await solveChallenge({
      challenge: typed,
      deriveKey: pbkdf2.deriveKey,
      timeout: 30_000,
    });
    if (!solution) throw new Error('ALTCHA 解題逾時');
    return btoa(JSON.stringify({ challenge, solution }));
  }
}
