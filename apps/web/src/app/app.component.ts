import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { WindowSizeDirective } from '@shared/directives/window-size.directive';
import { AppVersionService } from '@core/app-version.service';

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
  imports: [RouterOutlet, WindowSizeDirective],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class App {
  // 版本提示條是**唯一**掛在 root 的 UI。它沒有帶進任何依賴 ——
  // 純標記 + 一個 signal，見 app.component.html 的註解。
  protected readonly version = inject(AppVersionService);
}
