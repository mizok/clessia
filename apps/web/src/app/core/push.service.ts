import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';

import { environment } from '../../environments/environment';

/**
 * 這台裝置的推播狀態（設計稿 kb/wiki/architecture/web-push.md §4 的狀態表）。
 * 狀態只看瀏覽器給的事實，不靠版本號猜。
 */
export type PushState =
  /** 還在偵測 */
  | 'loading'
  /** iOS 而且不是從主畫面開的：先加入主畫面（iOS 16.4 起，加入主畫面的 Web App 才能推播） */
  | 'installable'
  /** 這個瀏覽器沒有 Push／Notification */
  | 'unsupported'
  /** 這份部署沒有設 VAPID 金鑰（`PUSH_NOT_CONFIGURED`）—— 自架可以不開推播 */
  | 'not-configured'
  /** 還沒問過權限 */
  | 'default'
  /** 已授權而且有訂閱 */
  | 'enabled'
  /** 已授權，但這台裝置被關掉了（使用者自己關、或登出）—— 等本人再按一次，不自動重訂 */
  | 'off'
  /** 被拒絕：瀏覽器不讓網頁再問一次，只能去系統設定打開 */
  | 'denied';

export type NotificationKind = 'invoice_due' | 'invoice_overdue';

export interface PushDevice {
  readonly id: string;
  readonly userAgent: string | null;
  readonly createdAt: string;
  readonly lastSuccessAt: string | null;
}

export interface NotificationPreference {
  readonly kind: NotificationKind;
  readonly enabled: boolean;
}

/**
 * 「這台裝置被關掉了」的記號。**有這個記號就不自動重訂**。
 *
 * 設計稿說「已授權但沒有訂閱 → 自動重訂」（換金鑰、被清掉的情況），但「使用者按了關閉」
 * 與「登出」留下的也是「已授權但沒有訂閱」—— 不分開的話，關掉的下一秒就被自動打開；
 * 登出後下一個登入這台裝置的家長，也會因為上一個人授權過而被默默訂閱。
 */
export const PUSH_OFF_KEY = 'clessia:push-off';

const SW_URL = '/sw.js';
/** 登出前取消訂閱最多等這麼久 —— 網路壞掉不能讓人登不出去 */
const FORGET_TIMEOUT_MS = 3000;

@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/me`;

  readonly state = signal<PushState>('loading');

  /** 偵測這台裝置的狀態；已授權但訂閱不見了或金鑰換了，就自動重訂（不打擾使用者） */
  async refresh(): Promise<void> {
    if (!pushSupported()) {
      this.state.set(isIos() && !isStandalone() ? 'installable' : 'unsupported');
      return;
    }
    const permission = Notification.permission;
    if (permission !== 'granted') {
      this.state.set(permission === 'denied' ? 'denied' : 'default');
      return;
    }
    const key = await this.publicKey();
    if (key === null) {
      this.state.set('not-configured');
      return;
    }
    const registration = await navigator.serviceWorker.register(SW_URL);
    const current = await registration.pushManager.getSubscription();
    if (current && sameKey(current, key)) {
      this.state.set('enabled');
      return;
    }
    // 金鑰換了：舊訂閱已經收不到（推播服務會拒絕新金鑰簽的請求），換一個
    if (current) await current.unsubscribe();
    if (readOff()) {
      this.state.set('off');
      return;
    }
    await this.subscribe(registration, key);
  }

  /** 使用者按「開啟」—— 一定要從按鈕直接呼叫（iOS 規定權限要由使用者操作觸發） */
  async enable(): Promise<void> {
    writeOff(false);
    if (Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      if (result !== 'granted') {
        this.state.set(result === 'denied' ? 'denied' : 'default');
        return;
      }
    }
    await this.refresh();
  }

  /** 「關閉這台裝置的通知」：伺服器先刪、再取消瀏覽器的訂閱，並記下「本人關的」 */
  async disableHere(): Promise<void> {
    writeOff(true);
    await this.forgetSubscription();
    this.state.set('off');
  }

  /**
   * **登出前呼叫**：刪掉這台裝置的訂閱，避免上一個人的提醒跳到下一個人的裝置上（#1663）。
   * 要在登出（清掉 session）**之前**跑 —— DELETE 要帶登入 cookie。
   * 最多等 3 秒；失敗或逾時都照樣讓人登出（伺服器那筆之後送不到會被清掉）。
   */
  async forgetThisDevice(): Promise<void> {
    writeOff(true);
    await Promise.race([
      this.forgetSubscription().catch(() => undefined),
      new Promise<void>((done) => setTimeout(done, FORGET_TIMEOUT_MS)),
    ]);
  }

  devices(): Observable<{ data: PushDevice[] }> {
    return this.http.get<{ data: PushDevice[] }>(`${this.base}/push-subscriptions`);
  }

  removeDevice(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/push-subscriptions/${id}`);
  }

  preferences(
    role: 'parent',
  ): Observable<{ role: 'parent'; preferences: NotificationPreference[] }> {
    return this.http.get<{ role: 'parent'; preferences: NotificationPreference[] }>(
      `${this.base}/notification-preferences`,
      { params: { role } },
    );
  }

  savePreferences(
    role: 'parent',
    preferences: NotificationPreference[],
  ): Observable<{ role: 'parent'; preferences: NotificationPreference[] }> {
    return this.http.put<{ role: 'parent'; preferences: NotificationPreference[] }>(
      `${this.base}/notification-preferences`,
      { role, preferences },
    );
  }

  /** 公鑰；這份部署沒開推播（404 `PUSH_NOT_CONFIGURED`）回 null，其他錯誤往上丟 */
  private async publicKey(): Promise<string | null> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ publicKey: string }>(`${this.base}/push-config`),
      );
      return res.publicKey;
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 404) return null;
      throw err;
    }
  }

  private async subscribe(registration: ServiceWorkerRegistration, key: string): Promise<void> {
    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(key),
    });
    const json = sub.toJSON();
    await firstValueFrom(
      this.http.post(`${this.base}/push-subscriptions`, {
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.['p256dh'], auth: json.keys?.['auth'] },
        userAgent: navigator.userAgent.slice(0, 300),
      }),
    );
    this.state.set('enabled');
  }

  /** 伺服器先刪（要用 endpoint 認），再取消瀏覽器的訂閱 */
  private async forgetSubscription(): Promise<void> {
    if (!pushSupported()) return;
    const registration = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = await registration?.pushManager.getSubscription();
    if (!sub) return;
    await firstValueFrom(
      this.http.delete(`${this.base}/push-subscriptions`, { body: { endpoint: sub.endpoint } }),
    );
    await sub.unsubscribe();
  }
}

function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13 起回報成 Mac；有觸控點的 Mac 就是 iPad
  return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function readOff(): boolean {
  try {
    return localStorage.getItem(PUSH_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(PUSH_OFF_KEY, '1');
    else localStorage.removeItem(PUSH_OFF_KEY);
  } catch {
    // 私密瀏覽之類存不了：最壞是下次又自動重訂一次，可以接受
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** 現有訂閱用的是不是這把公鑰（換金鑰後舊訂閱收不到） */
function sameKey(sub: PushSubscription, key: string): boolean {
  const current = sub.options.applicationServerKey;
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = base64UrlToBytes(key);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
