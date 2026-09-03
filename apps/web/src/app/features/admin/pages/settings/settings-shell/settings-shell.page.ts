import { Component, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter, map } from 'rxjs';
import { TabsModule } from 'primeng/tabs';

import { RouteObj } from '@core/smart-enums/routes-catalog';

interface SettingsTab {
  readonly value: string;
  readonly label: string;
}

/**
 * 系統設定的殼 —— 分校 / 學校 / 科目 / 一般四頁收成四個 tab，側欄少三項。
 *
 * **四個頁面元件一行都沒動**，它們仍然是各自 lazy load 的子路由；這裡只提供 tab 列
 * 與 `router-outlet`。舊網址（`/admin/campuses` 等）在 `app.routes.ts` 有 redirect，
 * 別人存的書籤不會 404。
 *
 * **當前 tab 讀的是 URL 不是本地 signal** —— 重整、分享連結、瀏覽器上一頁都停得住。
 * 反過來做（tab 存在元件裡、URL 不動）在這四頁特別糟：它們是「設定完就把網址貼給同事」
 * 的那種頁面。
 */
@Component({
  selector: 'app-settings-shell',
  standalone: true,
  imports: [RouterOutlet, TabsModule],
  templateUrl: './settings-shell.page.html',
  styleUrl: './settings-shell.page.scss',
})
export class SettingsShellPage {
  readonly page = input.required<RouteObj>();

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly tabs: readonly SettingsTab[] = [
    { value: 'campuses', label: '分校' },
    { value: 'schools', label: '學校' },
    { value: 'subjects', label: '科目' },
    { value: 'general', label: '一般' },
  ];

  protected readonly activeTab = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.currentTab()),
    ),
    { initialValue: this.currentTab() },
  );

  protected onTabChange(value: string | number | undefined): void {
    if (value === undefined) return;
    void this.router.navigate([String(value)], { relativeTo: this.route });
  }

  /** 子路由那一段就是 tab —— 進 `/admin/settings` 時 redirect 還沒跑完，先給第一個 */
  private currentTab(): string {
    return this.route.firstChild?.snapshot.routeConfig?.path ?? this.tabs[0].value;
  }
}
