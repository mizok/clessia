import { Component, inject, signal } from '@angular/core';
import { AuthService } from '@core/auth.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';

@Component({
  selector: 'app-login',
  imports: [InlineNoticeComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  host: { class: 'u-centered-flex' },
})
export class LoginComponent {
  private readonly auth = inject(AuthService);

  protected readonly error = signal<string | null>(null);
  protected readonly submitting = signal(false);

  /**
   * 這個系統沒有密碼。原因見 `kb/wiki/architecture/line-oauth-login.md`：
   * 密碼雜湊超過 Cloudflare Workers 的 CPU 上限，登入間歇性 503。
   *
   * 第一次進來的人沒有 LINE 可以按 —— 他們拿的是管理員產生的一次性連結，
   * 點開就登入，然後在畫面上綁定 LINE。之後才走這顆按鈕。
   */
  protected async signInWithLine(): Promise<void> {
    this.error.set(null);
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
