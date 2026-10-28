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
  /** 顯示給使用者、在 Safari 輸入的 4 位數（防交接劫持） */
  readonly pairCode: string;
  readonly expiresAt: number;
}

/** LINE 授權完的落地頁（輸入配對碼）。只帶 id，secret 永遠不進 URL */
export const handoffCallbackURL = (id: string) =>
  `${window.location.origin}/login/handoff?h=${encodeURIComponent(id)}`;

/**
 * 外部瀏覽器裡的發起頁（#2063）：OAuth 必須**在回呼會落的那個瀏覽器發起**，state cookie 才對得上 ——
 * PWA 自己呼叫 sign-in 的話 state cookie 寫在 PWA，LINE 授權完卻回到 Safari，Better Auth 判 state_mismatch。
 * 一樣只帶 id。
 */
const startURLFor = (id: string) =>
  `${window.location.origin}/login/handoff/start?h=${encodeURIComponent(id)}`;

export type RedeemResult = 'none' | 'pending' | 'redirected' | 'invalid';

/** Safari 頁輸入配對碼的結果；mismatch 帶剩幾次 */
export type CompleteResult =
  | { readonly kind: 'done' }
  | { readonly kind: 'mismatch'; readonly attemptsLeft: number }
  | { readonly kind: 'failed' };

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
      this.http.post<{
        handoffId: string;
        secret: string;
        pairCode: string;
        expiresInSeconds: number;
      }>(`${this.base}/start`, {}),
    );
    const stored: StoredHandoff = {
      id: res.handoffId,
      secret: res.secret,
      pairCode: res.pairCode,
      expiresAt: Date.now() + res.expiresInSeconds * 1000,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return this.externalStartLink(res.handoffId);
  }

  /** 進行中交接的發起連結（PWA 被重新載入後沿用同一個交接，不重發新碼）；沒有就 null */
  pendingStartLink(): string | null {
    const stored = this.read();
    return stored ? this.externalStartLink(stored.id) : null;
  }

  /**
   * 從 PWA 打開外部瀏覽器的連結（#2063）。**要開在 Safari 本身**：使用者實機紀錄是 LINE App 授權完回到 Safari，
   * 而 iOS 主畫面 PWA 用一般連結（`target=_blank`）開自己網域的頁面時，可能開在 PWA 內嵌的瀏覽頁 ——
   * 那裡的 cookie 跟 Safari 不同，state 照樣對不上。iOS（`navigator.standalone` 只有 iOS 有）用
   * `x-safari-https://` 指名交給 Safari（iOS 17 起）；其他平台（Android 的 PWA 跟 Chrome 共用 cookie）用一般網址。
   * ponytail: 這是依實機行為選的開法，PR 請使用者 iPhone／Android 各走一次確認
   */
  private externalStartLink(id: string): string {
    const url = startURLFor(id);
    const isIos = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return isIos ? url.replace(/^(https?):\/\//, 'x-safari-$1://') : url;
  }

  /** 進行中交接的配對碼（PWA 顯示給使用者，在 Safari 輸入）；沒有就 null */
  pendingPairCode(): string | null {
    return this.read()?.pairCode ?? null;
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
   * Safari 那邊（callback 落地頁）：使用者**輸入 App 上的配對碼並按確認**才呼叫（不自動 —— 防交接劫持）。
   * 完成，或交接已失效，就**登出 Safari**（使用者 10-23 裁定）；碼打錯還能再試，先不登出。
   */
  async complete(id: string, pairCode: string): Promise<CompleteResult> {
    try {
      await firstValueFrom(
        this.http.post(
          `${environment.apiUrl}/api/me/auth-handoff/${encodeURIComponent(id)}/complete`,
          { pairCode },
          { withCredentials: true },
        ),
      );
      await this.signOutHere().catch(() => undefined);
      return { kind: 'done' };
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 400 && err.error?.attemptsLeft) {
        return { kind: 'mismatch', attemptsLeft: err.error.attemptsLeft as number };
      }
      await this.signOutHere().catch(() => undefined);
      return { kind: 'failed' };
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
      if (!stored?.id || !stored.secret || !stored.pairCode || stored.expiresAt < Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return stored;
    } catch {
      return null;
    }
  }
}
