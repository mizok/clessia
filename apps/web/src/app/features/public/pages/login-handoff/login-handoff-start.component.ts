import { Component, afterNextRender, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '@core/auth.service';
import { handoffCallbackURL } from '@core/auth-handoff.service';

/**
 * iOS 主畫面 PWA 的 LINE 登入，在外部瀏覽器（Safari）的發起頁（#2063）。
 *
 * **OAuth 要在回呼會落的那個瀏覽器發起**：Better Auth 回呼時比對發起時設下的 state cookie（防 login CSRF）。
 * 原本 PWA 自己呼叫 sign-in，state cookie 寫在 PWA，LINE App 授權完卻回到 Safari → state_mismatch，
 * 使用者落在登入頁、沒有地方輸入號碼。這一頁在 Safari 裡發起，回呼就落在同一個瀏覽器，再照舊到 `/login/handoff?h=` 輸入號碼。
 *
 * 只收交接 id（`?h=`），不帶任何秘密 —— 別人拿到這個連結，頂多讓你用**你自己的** LINE 登入，
 * 還是要輸入只顯示在發起者 App 上的 4 位數才交得出去。
 */
@Component({
  selector: 'app-login-handoff-start',
  template: `
    <div class="w-full max-w-[380px] max-[860px]:px-6 max-[860px]:py-8" aria-live="polite">
      @if (!id) {
        <h1 class="m-0 text-2xl font-bold tracking-[-0.02em] text-zinc-900">連結不完整</h1>
        <p class="mx-0 mb-0 mt-2 text-md leading-[1.75] text-zinc-700">
          請回到主畫面上的 App，再按一次「使用 LINE 登入」。
        </p>
      } @else {
        <h1 class="m-0 text-2xl font-bold tracking-[-0.02em] text-zinc-900">前往 LINE 登入</h1>
        <p class="mx-0 mb-0 mt-2 text-md leading-[1.75] text-zinc-700">
          登入完會回到這個瀏覽器，請輸入 App 上顯示的 4 位數號碼。
        </p>
        @if (error()) {
          <p class="mx-0 mb-0 mt-3 text-sm text-error-700" data-testid="handoff-start-error">
            {{ error() }}
          </p>
        }
        <button
          type="button"
          class="mt-4 h-12 w-full cursor-pointer rounded-lg border-0 bg-[#06c755] px-4 text-base font-semibold text-white disabled:cursor-progress disabled:opacity-60"
          [disabled]="busy()"
          (click)="go()"
        >
          {{ busy() ? '前往 LINE…' : '使用 LINE 登入' }}
        </button>
      }
    </div>
  `,
  host: {
    class:
      'flex min-h-full items-center justify-center max-[1024px]:min-h-0 max-[1024px]:items-start',
  },
})
export class LoginHandoffStartComponent {
  private readonly auth = inject(AuthService);
  protected readonly id = inject(ActivatedRoute).snapshot.queryParamMap.get('h');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // 進頁就自動前往（使用者在 App 已經按過一次）；失敗或沒動時頁面上有按鈕可以再按
    afterNextRender(() => {
      if (this.id) void this.go();
    });
  }

  protected async go(): Promise<void> {
    if (!this.id || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const message = await this.auth.signInWithLine(handoffCallbackURL(this.id));
      if (message) this.error.set(message);
      // 成功的話瀏覽器已經被導去 LINE
    } catch {
      this.error.set('連不上伺服器，請重新整理頁面後再試');
    } finally {
      this.busy.set(false);
    }
  }
}
