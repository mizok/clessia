import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
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
  }
}
