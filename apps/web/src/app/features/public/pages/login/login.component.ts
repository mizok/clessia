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

  constructor() {
    // OAuth 的失敗是被導回來時寫在網址上的，不是函式回傳值
    const oauthError = oauthErrorFor(this.route.snapshot.queryParamMap.get('error'));
    if (oauthError) {
      this.error.set(oauthError.message);
      this.showEnrollmentLink.set(oauthError.showEnrollmentLink);
    }
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
