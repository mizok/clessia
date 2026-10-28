import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthHandoffService } from '@core/auth-handoff.service';

/**
 * iOS 主畫面 PWA 發起的 LINE 登入，在 Safari 完成後落在這裡（#2027）。
 * 把交接標成目前登入的人、登出 Safari，請使用者回到 App —— App 回前景就會用 secret 換到登入。
 * 不掛 guestGuard：落地時 Safari 是登入狀態，被導走就標不到了。
 */
@Component({
  selector: 'app-login-handoff',
  template: `
    <div class="w-full max-w-[380px] max-[860px]:px-6 max-[860px]:py-8" aria-live="polite">
      @switch (state()) {
        @case ('working') {
          <h1 class="m-0 text-2xl font-bold tracking-[-0.02em] text-zinc-900">登入中…</h1>
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
            可能已經超過 10 分鐘。請回到 App，再按一次「使用 LINE 登入」。
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
  protected readonly state = signal<'working' | 'done' | 'failed'>('working');

  constructor() {
    const id = inject(ActivatedRoute).snapshot.queryParamMap.get('h');
    if (!id) {
      this.state.set('failed');
      return;
    }
    void this.handoff.complete(id).then((ok) => this.state.set(ok ? 'done' : 'failed'));
  }
}
