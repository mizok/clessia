import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '@core/auth.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';
import { oauthErrorFor } from './oauth-error';

@Component({
  selector: 'app-login',
  imports: [InlineNoticeComponent, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  protected readonly error = signal<string | null>(null);
  protected readonly submitting = signal(false);
  /** 未登記的人需要報名入口，不是「再試一次」 */
  protected readonly showEnrollmentLink = signal(false);
  /**
   * guard 判斷 `/api/me` 是暫時性錯誤（5xx、斷線）而不是真的未登入時，
   * 會帶 `?reason=connection-error` 把人導來這裡（見 auth.guard.ts）。
   * 這種情況不是「登入失敗」，是「不知道」——訊息跟一般未登入不同，且要給重試。
   */
  protected readonly showRetry = signal(false);

  constructor() {
    // OAuth 的失敗是被導回來時寫在網址上的，不是函式回傳值
    const oauthError = oauthErrorFor(this.route.snapshot.queryParamMap.get('error'));
    if (oauthError) {
      this.error.set(oauthError.message);
      this.showEnrollmentLink.set(oauthError.showEnrollmentLink);
    }

    if (this.route.snapshot.queryParamMap.get('reason') === 'connection-error') {
      this.error.set('連線異常，請重試。若持續發生請聯繫補習班。');
      this.showRetry.set(true);
    }
  }

  /** 重新整理讓 AuthService 重跑一次 /api/me —— 通常是後端偶發性的 5xx，重試就好 */
  protected retry(): void {
    window.location.reload();
  }

  /**
   * 這個系統沒有密碼。原因見 `kb/wiki/architecture/line-oauth-login.md`：
   * 密碼雜湊超過 Cloudflare Workers 的 CPU 上限，登入間歇性 503。
   *
   * 第一次進來的人沒有 LINE 可以按 —— 他們拿的是管理員產生的一次性連結，
   * 點開就登入，然後在畫面上綁定 LINE。之後才走這顆按鈕。
   */
  protected async signInWithLine(): Promise<void> {
    this.error.set(null);
    this.showEnrollmentLink.set(false);
    this.submitting.set(true);

    try {
      const errorMsg = await this.auth.signInWithLine();
      if (errorMsg) {
        this.error.set(errorMsg);
      }
      // 成功的話瀏覽器已經被導去 LINE，這裡不會再執行到
    } catch {
      // 不接住的話按鈕會永遠卡在「登入中」
      this.error.set('無法連線到 LINE，請稍後再試');
    } finally {
      this.submitting.set(false);
    }
  }
}
