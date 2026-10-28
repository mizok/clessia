import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '@env/environment';
import { authClient } from './auth-client';

/** PWA 自己的 storage（iOS 主畫面 PWA 與 Safari 不共用），存這次交接的 id＋secret */
const STORAGE_KEY = 'clessia.authHandoff';

interface StoredHandoff {
  readonly id: string;
  readonly secret: string;
  readonly expiresAt: number;
}

export type RedeemResult = 'none' | 'pending' | 'redirected' | 'invalid';

/**
 * iOS 主畫面 PWA 的外部登入交接（#2027，kb/wiki/architecture/pwa-oauth-handoff.md）。
 *
 * iOS 主畫面 PWA 與 Safari 不共用 cookie：LINE 授權完落在 Safari，PWA 仍未登入。
 * PWA 發起時拿到 id＋secret（**secret 只存在 PWA 的 localStorage，不進任何 URL**），外部流程的
 * callbackURL 只帶 id；Safari 登入完成的頁面標記交接並登出 Safari；PWA 回前景用 secret 換一次性登入連結。
 */
@Injectable({ providedIn: 'root' })
export class AuthHandoffService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/auth-handoff`;

  /** 從主畫面打開的 PWA（iOS 用 `navigator.standalone`，其他用 display-mode） */
  isStandalonePwa(): boolean {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  }

  /** 發起：存好 id＋secret，回外部流程要用的 callbackURL（只帶 id） */
  async start(): Promise<string> {
    const res = await firstValueFrom(
      this.http.post<{ handoffId: string; secret: string; expiresInSeconds: number }>(
        `${this.base}/start`,
        {},
      ),
    );
    const stored: StoredHandoff = {
      id: res.handoffId,
      secret: res.secret,
      expiresAt: Date.now() + res.expiresInSeconds * 1000,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return `${window.location.origin}/login/handoff?h=${encodeURIComponent(res.handoffId)}`;
  }

  /**
   * PWA 回前景時呼叫：有進行中的交接就去換。換到連結就在**這個視窗**打開（session 寫進 PWA）。
   * 交接失效（過期、secret 不對、已換過）就清掉，不再重試。
   */
  async redeem(): Promise<RedeemResult> {
    const stored = this.read();
    if (!stored) return 'none';
    try {
      const res = await firstValueFrom(
        this.http.post<{ url?: string; status?: 'pending' }>(
          `${this.base}/${stored.id}/redeem`,
          { secret: stored.secret },
          { observe: 'response' },
        ),
      );
      if (res.status === 202) return 'pending';
      localStorage.removeItem(STORAGE_KEY);
      if (!res.body?.url) return 'invalid';
      this.go(res.body.url);
      return 'redirected';
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 404) {
        localStorage.removeItem(STORAGE_KEY);
        return 'invalid';
      }
      // 連線層的錯：留著交接，下次回前景再試
      return 'pending';
    }
  }

  /**
   * Safari 那邊（callback 落地頁）：把交接標成目前登入的人，然後**登出 Safari**（使用者 10-23 裁定 ——
   * 家長不該在 Safari 也一直是登入狀態）。登出失敗不影響交接。
   */
  async complete(id: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.post(
          `${this.base}/${encodeURIComponent(id)}/complete`,
          {},
          { withCredentials: true },
        ),
      );
      return true;
    } catch {
      return false;
    } finally {
      await this.signOutHere().catch(() => undefined);
    }
  }

  /** 登出這個瀏覽器（Safari）的 session（spec 換掉它：authClient 是 proxy，spy 不到） */
  protected signOutHere(): Promise<unknown> {
    return authClient.signOut({ fetchOptions: { credentials: 'include' } });
  }

  /** 在這個視窗打開一次性登入連結（spec 換掉它） */
  protected go(url: string): void {
    window.location.assign(url);
  }

  private read(): StoredHandoff | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw) as StoredHandoff;
      if (!stored?.id || !stored.secret || stored.expiresAt < Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return stored;
    } catch {
      return null;
    }
  }
}
