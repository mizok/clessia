import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { environment } from '@env/environment';

/** 前端認得、畫得出按鈕的 provider。API 回了但這裡沒有的不畫（不猜樣式） */
export const PROVIDER_NAMES = { line: 'LINE', google: 'Google' } as const;
export type ProviderId = keyof typeof PROVIDER_NAMES;

export function isProviderId(id: unknown): id is ProviderId {
  return typeof id === 'string' && Object.hasOwn(PROVIDER_NAMES, id);
}

/** Google 一律擋 LINE 內建瀏覽器（403 disallowed_useragent）。LINE 的 in-app UA 帶 ` Line/<版本>` */
export function isLineInAppBrowser(userAgent = navigator.userAgent): boolean {
  return / Line\//.test(userAgent);
}

/**
 * 這個部署掛了哪些登入方式（#1842）。provider 清單不寫死：只有 API 知道自己有沒有設憑證（c12）。
 *
 * 讀到之前、或讀不到時都是 `['line']` —— 今天的畫面就是這樣，只設 LINE 的部署不會閃，
 * 清單讀不到也不會讓所有人都登不進來。
 */
@Injectable({ providedIn: 'root' })
export class AuthProvidersService {
  private readonly list = signal<readonly ProviderId[]>(['line']);
  readonly providers = this.list.asReadonly();

  constructor() {
    inject(HttpClient)
      .get<{ providers: unknown[] }>(`${environment.apiUrl}/api/auth-providers`)
      .subscribe({
        next: ({ providers }) => this.list.set(providers.filter(isProviderId)),
        error: () => undefined,
      });
  }
}
