import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@core/auth.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';

/**
 * 一次性連結兌換完就落在這裡。**點連結進來的人下一步就是綁定 LINE。**
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
  styleUrl: './link-line.component.scss',
  host: { class: 'u-centered-flex' },
})
export class LinkLineComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly error = signal<string | null>(null);
  protected readonly submitting = signal(false);

  protected async linkLine(): Promise<void> {
    this.error.set(null);
    this.submitting.set(true);

    try {
      const errorMsg = await this.auth.linkLine();
      if (errorMsg) {
        this.error.set(errorMsg);
      }
      // 成功的話瀏覽器已經被導去 LINE
    } catch {
      this.error.set('無法連線到 LINE，請稍後再試');
    } finally {
      this.submitting.set(false);
    }
  }

  protected skip(): void {
    void this.router.navigate(['/select-role']);
  }
}
