import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthHandoffService } from '@core/auth-handoff.service';

/**
 * iOS 主畫面 PWA 發起的 LINE 登入，在 Safari 完成後落在這裡（#2027）。
 *
 * **不在載入時自動完成**（計畫席讀 diff 擋：防交接劫持 —— 別人把他的交接連結傳給你，你一點就把自己的帳號交出去）。
 * 要使用者輸入主畫面 App 上顯示的 4 位數並按確認才完成；完成後登出 Safari、請他回到 App。
 * 不掛 guestGuard：落地時 Safari 是登入狀態，被導走就做不了。
 */
@Component({
  selector: 'app-login-handoff',
  imports: [FormsModule],
  template: `
    <div class="w-full max-w-[380px] max-[860px]:px-6 max-[860px]:py-8" aria-live="polite">
      @switch (state()) {
        @case ('ask') {
          <h1 class="m-0 text-2xl font-bold tracking-[-0.02em] text-zinc-900">
            把這次登入交給 App？
          </h1>
          <p class="mx-0 mb-0 mt-2 text-md leading-[1.75] text-zinc-700">
            請輸入主畫面 App 上顯示的 4 位數號碼。
            <b class="font-semibold">如果這不是你剛剛在 App 上按的登入，請直接關掉這個頁面。</b>
          </p>
          <form class="mt-4 flex flex-col gap-3" (ngSubmit)="confirm()">
            <label class="flex flex-col gap-1 text-sm font-semibold text-zinc-700">
              App 上的號碼
              <input
                class="h-12 rounded-md border border-solid border-zinc-300 px-3 text-center text-2xl tracking-[0.3em] tabular-nums"
                name="pairCode"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="4"
                pattern="[0-9]{4}"
                required
                [(ngModel)]="code"
              />
            </label>
            @if (message()) {
              <p class="m-0 text-sm text-error-700" data-testid="handoff-message">
                {{ message() }}
              </p>
            }
            <button
              type="submit"
              class="h-12 cursor-pointer rounded-lg border-0 bg-zinc-900 px-4 text-base font-semibold text-white disabled:cursor-progress disabled:opacity-60"
              [disabled]="busy() || !isCode(code)"
            >
              {{ busy() ? '確認中…' : '確認，交給 App 登入' }}
            </button>
          </form>
        }
        @case ('done') {
          <h1 class="m-0 text-2xl font-bold tracking-[-0.02em] text-zinc-900">已登入</h1>
          <p class="mx-0 mb-0 mt-2 text-md leading-[1.75] text-zinc-700">
            請回到主畫面上的 App，它會自動完成登入。這個瀏覽器頁面可以關掉了。
          </p>
        }
        @case ('failed') {
          <h1 class="m-0 text-2xl font-bold tracking-[-0.02em] text-zinc-900">登入沒有完成</h1>
          <p class="mx-0 mb-0 mt-2 text-md leading-[1.75] text-zinc-700">
            可能已經超過 10 分鐘，或號碼錯太多次。請回到 App，再按一次「使用 LINE 登入」。
          </p>
        }
      }
    </div>
  `,
  host: {
    class:
      'flex min-h-full items-center justify-center max-[1024px]:min-h-0 max-[1024px]:items-start',
  },
})
export class LoginHandoffComponent {
  private readonly handoff = inject(AuthHandoffService);
  private readonly id = inject(ActivatedRoute).snapshot.queryParamMap.get('h');
  protected readonly state = signal<'ask' | 'done' | 'failed'>(this.id ? 'ask' : 'failed');
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected code = '';

  protected isCode(value: string): boolean {
    return /^\d{4}$/.test(value);
  }

  protected async confirm(): Promise<void> {
    if (!this.id || this.busy() || !this.isCode(this.code)) return;
    this.busy.set(true);
    const result = await this.handoff.complete(this.id, this.code);
    this.busy.set(false);
    if (result.kind === 'mismatch') {
      this.message.set(`號碼不對，請看 App 上顯示的 4 位數（還可以試 ${result.attemptsLeft} 次）`);
      return;
    }
    this.state.set(result.kind);
  }
}
