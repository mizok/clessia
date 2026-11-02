import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '@core/auth.service';
import {
  AuthProvidersService,
  PROVIDER_NAMES,
  type ProviderId,
  isLineInAppBrowser,
} from '@core/auth-providers.service';
import { oauthErrorFor } from '../login/oauth-error';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';

/**
 * 一次性連結兌換完就落在這裡。**點連結進來的人下一步就是綁定 LINE／Google**（#1842：依部署掛了哪些）。
 * 路由維持 `/link-line`：已經印出去、傳出去的綁定連結都導到這裡，改名會讓舊連結落空。
 *
 * 綁定之後他們用 LINE 登入，不再需要向補習班要連結。臨櫃註冊完當場掃 QR 是成功率
 * 最高的時刻（家長本人在場、有真人可以帶著操作）。
 *
 * 「稍後再說」是刻意留的：破窗進來的人（供應商幫客戶處理問題）不會想把自己的 LINE
 * 綁上客戶的帳號。**沒綁定是合法且永久的狀態** —— 系統不會因此不能運作。
 */
@Component({
  selector: 'app-link-line',
  imports: [InlineNoticeComponent],
  templateUrl: './link-line.component.html',
  host: { class: 'u-centered-flex' },
})
export class LinkLineComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  protected readonly error = signal<string | null>(null);
  /** 正在前往哪一家；null＝沒有在送出 */
  protected readonly submitting = signal<ProviderId | null>(null);
  protected readonly providers = inject(AuthProvidersService).providers;
  protected readonly names = PROVIDER_NAMES;
  /** Google 一律擋 LINE 內建瀏覽器（403 disallowed_useragent），而綁定連結常用 LINE 傳（使用者 11-02） */
  protected readonly inLineApp = isLineInAppBrowser();
  /** 只有 LINE 時標題跟以前一樣「綁定 LINE」；兩個以上叫「綁定登入方式」 */
  protected readonly title = computed(() =>
    this.providers().length === 1 ? `綁定 ${PROVIDER_NAMES[this.providers()[0]!]}` : '綁定登入方式',
  );
  protected readonly providerNames = computed(() =>
    this.providers()
      .map((p) => PROVIDER_NAMES[p])
      .join(' 或 '),
  );

  constructor() {
    // 綁定失敗（例如這個帳號已經綁給別人）會被導回這裡，錯誤寫在網址上
    const query = this.route.snapshot.queryParamMap;
    this.error.set(oauthErrorFor(query.get('error'), query.get('provider'))?.message ?? null);

    // 掃碼機台（#1127）是平板不是人，沒有 LINE 可綁：兌換完連結直接進打卡頁
    // （這條路由掛 authGuard，所以 roles 已經載入）
    const roles = this.auth.roles();
    if (roles.length === 1 && roles[0] === 'kiosk') {
      this.auth.navigateToRoleShell('kiosk');
    }
  }

  protected async link(provider: ProviderId): Promise<void> {
    this.error.set(null);
    this.submitting.set(provider);

    try {
      const errorMsg = await this.auth.linkProvider(provider);
      if (errorMsg) {
        this.error.set(errorMsg);
      }
      // 成功的話瀏覽器已經被導去 LINE／Google
    } catch {
      this.error.set(`無法連線到 ${PROVIDER_NAMES[provider]}，請稍後再試`);
    } finally {
      this.submitting.set(null);
    }
  }

  protected skip(): void {
    void this.router.navigate(['/select-role']);
  }
}
