import { Component, DOCUMENT, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, take } from 'rxjs';
import { WindowSizeDirective } from '@shared/directives/window-size.directive';
import { AppVersionService } from '@core/app-version.service';
import { ToastComponent } from '@shared/components/toast/toast.component';

/**
 * 這裡刻意只有 router-outlet。
 *
 * 曾經掛過一個角色選擇用的 DynamicDialog，代價是 PrimeNG 的 dialog 依賴樹
 * （dialog / button / dom / motion / icons）跟著 root component 進了初始 bundle，
 * 約 140 kB —— 所有人都下載，只有多重角色的人看得到。角色選擇已經移到
 * `/select-role` 這條 lazy route。**不要再往 root component 加 UI 依賴。**
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, WindowSizeDirective, ToastComponent],
  templateUrl: './app.component.html',
})
export class App {
  // 掛在 root 的 UI 只有兩樣，都沒有帶進 PrimeNG 元件：版本提示條（純標記＋一個 signal，
  // 見 app.component.html）與全站唯一的 toast 出口（#1615，只吃 primeng/api 的 MessageService）。
  protected readonly version = inject(AppVersionService);

  constructor() {
    // 導覽結束也比一次版本（#1930）：櫃檯整天開著同一個分頁、從不切走，「回到前景」永遠不會觸發。
    // 跟回前景共用 60 秒節流。掛在這裡而不是 AppVersionService：那支被 ErrorHandler 注入，
    // 再讓它注入 Router 有 DI 循環的風險
    inject(Router)
      .events.pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => void this.version.checkForNewVersion());

    // 開站畫面（index.html）靠 CSS :has() 在第一個路由元件掛上時自己淡出；這裡等淡出跑完
    // （transitionend）再把節點拿掉，不讓它一直留在 DOM 裡。不能用固定延遲：NavigationEnd 到
    // 畫面 render 的間隔不固定（guard 導去 /login 時更長），實測 200／300ms 都會在淡出尾巴抽掉。
    // 逾時是給不支援 :has() 的舊瀏覽器（Safari < 15.4）：那裡沒有 transition，到時直接收
    const doc = inject(DOCUMENT);
    inject(Router)
      .events.pipe(
        filter((e) => e instanceof NavigationEnd),
        take(1),
      )
      .subscribe(() => {
        const splash = doc.querySelector('.app-splash');
        if (!splash) return;
        splash.addEventListener('transitionend', () => splash.remove(), { once: true });
        setTimeout(() => splash.remove(), SPLASH_FALLBACK_MS);
      });
  }
}

/** 不支援 :has() 時，第一次導覽結束後多久收掉開站畫面 */
const SPLASH_FALLBACK_MS = 800;
