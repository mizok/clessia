import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { AppVersionService } from '@core/app-version.service';
import { AuthService } from '@core/auth.service';
import { AuthHandoffService } from '@core/auth-handoff.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';
import { oauthErrorFor } from './oauth-error';

@Component({
  selector: 'app-login',
  imports: [InlineNoticeComponent, NgTemplateOutlet],
  templateUrl: './login.component.html',
  // 桌機在白面裡垂直置中；手機表單面從返回列下方開始排（A6），不撐滿高度，否則多出一截空捲動
  host: {
    class:
      'flex min-h-full items-center justify-center max-[1024px]:min-h-0 max-[1024px]:items-start',
  },
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly version = inject(AppVersionService);
  private readonly route = inject(ActivatedRoute);
  private readonly handoff = inject(AuthHandoffService);

  /** iOS 主畫面 PWA 已發起 LINE 登入、還在等 Safari 那邊完成（#2027） */
  protected readonly handoffWaiting = signal(false);

  protected readonly error = signal<string | null>(null);
  protected readonly submitting = signal(false);
  /** 未登記的人需要「怎麼被登記」，不是「再試一次」也不是一條連到空殼頁的連結（#694） */
  protected readonly showRegisterHint = signal(false);
  /**
   * guard 判斷 `/api/me` 是暫時性錯誤（5xx、斷線）而不是真的未登入時，
   * 會帶 `?reason=connection-error` 把人導來這裡（見 auth.guard.ts）。
   * 這種情況不是「登入失敗」，是「不知道」——訊息跟一般未登入不同，且要給重試。
   */
  protected readonly showRetry = signal(false);

  private readonly sheet = viewChild.required<ElementRef<HTMLElement>>('sheet');

  constructor() {
    // 手機登入彈窗（#2031 起是置中彈窗，原本是底部面板）搬到 <body>：它在模板裡的位置是 <main [inert]> 底下（停在品牌面時表單面是 inert），
    // 進了 top layer 看得見，整棵子樹卻還是 inert —— LINE 鍵拿不到焦點、點擊穿到後面的 nav（#1639 二讀）。
    // 搬出去之後元件銷毀時 Angular 不會收它（它不在 host 底下了），要自己移除。
    afterNextRender(() => document.body.append(this.sheet().nativeElement));
    inject(DestroyRef).onDestroy(() => this.sheet().nativeElement.remove());

    // OAuth 的失敗是被導回來時寫在網址上的，不是函式回傳值
    const oauthError = oauthErrorFor(this.route.snapshot.queryParamMap.get('error'));
    if (oauthError) {
      this.error.set(oauthError.message);
      this.showRegisterHint.set(oauthError.showRegisterHint);
    }

    // #2027：PWA 回到前景（從 Safari 切回來）就去換交接；進頁時也換一次（iOS 可能把 PWA 重新載入）
    void this.tryHandoff();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.tryHandoff();
    };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('visibilitychange', onVisible));

    if (this.route.snapshot.queryParamMap.get('reason') === 'connection-error') {
      this.error.set('連線異常，請重試。若持續發生請聯繫補習班。');
      this.showRetry.set(true);
    }
  }

  private async tryHandoff(): Promise<void> {
    const result = await this.handoff.redeem();
    this.handoffWaiting.set(result === 'pending');
    if (result === 'invalid') this.error.set('登入逾時，請再按一次「使用 LINE 登入」');
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
    this.showRegisterHint.set(false);
    this.submitting.set(true);

    try {
      const errorMsg = await this.auth.signInWithLine();
      if (errorMsg) {
        this.error.set(errorMsg);
      }
      // 成功的話瀏覽器已經被導去 LINE，這裡不會再執行到
    } catch (err) {
      // 不接住的話按鈕會永遠卡在「登入中」。
      // 舊版 chunk（現在這條路上沒有 import()，將來 auth client 改 lazy 時才會有）：亮提示條就好
      if (this.version.recoverFromImportFailure(err)) return;
      // #1718：原本寫「無法連線到 LINE」—— 但丟例外的是我們的 API（連線層），不是 LINE，
      // 而使用者實際上是重新整理之後就好了。原始錯誤記下來，下次撞到才查得到（原本整個丟掉）
      console.warn('[line-login]', redactedError(err));
      this.error.set('連不上伺服器，請重新整理頁面後再試');
    } finally {
      this.submitting.set(false);
    }
  }
}

/** 只留錯誤名與訊息；網址的 query（OAuth 的 state、token）遮掉，不印進 console（#1718 計畫席） */
function redactedError(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.replace(/\?[^\s]*/g, '?…');
}
