import { Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';

import { CampusesService, type Campus } from '@core/campuses.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { SchoolsService } from '@core/schools.service';
import { RouteObj, RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { SubjectsService } from '@core/subjects.service';

interface SettingsTab {
  readonly value: string;
  readonly label: string;
  readonly href: string;
}

/**
 * 系統設定的殼 —— 一般 / 分校 / 學校 / 科目四頁收成四個分頁，側欄少三項。
 *
 * **四個頁面元件一行都沒動**，它們仍然是各自 lazy load 的子路由；這裡只提供分頁列
 * 與 `router-outlet`。舊網址（`/admin/campuses` 等）在 `app.routes.ts` 有 redirect，
 * 別人存的書籤不會 404。
 *
 * A6 settings.html（#1755 計畫席：殼另開一張）：
 * - 分頁是灰工具列裡的連結列（`nav[系統設定]`），順序「一般、分校、學校、科目」，分校／學校／科目帶筆數
 * - 色面標題回答「分校怎麼在營運」：「N 個分校在營運，全部用日到班／全部用隨堂點名／M 個用日到班。」
 *   分校沒設出勤模式時沿用機構預設（同分校列表 #1755）。資料還沒到或讀失敗 → 標題退回「系統設定」
 *
 * **當前分頁讀的是 URL 不是本地 signal** —— 重整、分享連結、瀏覽器上一頁都停得住。
 * 反過來做（分頁存在元件裡、URL 不動）在這四頁特別糟：它們是「設定完就把網址貼給同事」
 * 的那種頁面。
 */
@Component({
  selector: 'app-settings-shell',
  standalone: true,
  imports: [RouterOutlet, PageOpenComponent],
  templateUrl: './settings-shell.page.html',
})
export class SettingsShellPage {
  readonly page = input.required<RouteObj>();

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly campusesApi = inject(CampusesService);
  private readonly schoolsApi = inject(SchoolsService);
  private readonly subjectsApi = inject(SubjectsService);
  private readonly orgSettings = inject(OrgSettingsService);

  protected readonly tabs: readonly SettingsTab[] = [
    RoutesCatalog.ADMIN_SETTINGS_GENERAL,
    RoutesCatalog.ADMIN_CAMPUSES,
    RoutesCatalog.ADMIN_SCHOOLS,
    RoutesCatalog.ADMIN_SUBJECTS,
  ].map((r) => ({
    value: r.relativePath,
    label: { general: '一般', campuses: '分校', schools: '學校', subjects: '科目' }[
      r.relativePath
    ]!,
    href: r.absolutePath,
  }));

  private readonly navEnd = this.router.events.pipe(
    filter((event) => event instanceof NavigationEnd),
  );

  protected readonly activeTab = toSignal(this.navEnd.pipe(map(() => this.currentTab())), {
    initialValue: this.currentTab(),
  });

  private readonly campuses = signal<Campus[] | null>(null);
  private readonly counts = signal<Record<string, number>>({});

  /** 色面標題；分校還沒讀到（或讀失敗）→ null，模板退回頁名 */
  protected readonly headline = computed(() => {
    const list = this.campuses();
    if (!list) return null;
    const def = this.orgSettings.settings()?.attendanceMode ?? null;
    const on = list.filter((c) => c.isActive);
    const daily = on.filter((c) => (c.attendanceMode ?? def) === 'daily_checkin').length;
    // 機構預設還沒讀到時，沒設模式的分校算不出來 —— 只寫在營運幾個，不猜
    const unknown = !def && on.some((c) => !c.attendanceMode);
    const second = unknown
      ? null
      : daily === on.length
        ? '全部用日到班。'
        : daily === 0
          ? '全部用隨堂點名。'
          : `${daily} 個用日到班。`;
    return second
      ? { first: `${on.length} 個分校在營運，`, second }
      : { first: `${on.length} 個分校在營運。`, second: null };
  });

  constructor() {
    if (this.orgSettings.status() !== 'ready') this.orgSettings.load();
    // 每次切分頁重抓：在分校／學校／科目分頁新增、停用之後，標題與筆數跟著對
    // ponytail: 三支輕量清單一起重抓；分頁裡的寫入改成通知殼之前，這樣最省事
    this.navEnd.pipe(startWith(null), takeUntilDestroyed()).subscribe(() => this.loadSummary());
  }

  protected count(tab: string): number | null {
    return this.counts()[tab] ?? null;
  }

  /** 一般點擊在 app 內導航；新分頁、⌘／Ctrl 點擊交給瀏覽器（連結本來就是真網址） */
  protected go(event: MouseEvent, value: string): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    void this.router.navigate([value], { relativeTo: this.route });
  }

  private loadSummary(): void {
    this.campusesApi.list({ pageSize: 0 }).subscribe({
      next: (res) => {
        this.campuses.set(res.data);
        this.counts.update((c) => ({ ...c, campuses: res.summary.total }));
      },
      error: () => this.campuses.set(null),
    });
    this.schoolsApi.list().subscribe({
      next: (res) => this.counts.update((c) => ({ ...c, schools: res.meta.total })),
    });
    this.subjectsApi.list().subscribe({
      next: (res) => this.counts.update((c) => ({ ...c, subjects: res.data.length })),
    });
  }

  /**
   * 子路由那一段就是分頁 —— 讀的是**殼自己的 snapshot 子樹**，不是 `route.firstChild.snapshot`。
   *
   * 差別在時序（#804）：router 的 `activateRoutes` 是
   * `advanceActivatedRoute(殼)` → `outlet.activateWith(殼)`（**這行建構本元件**）
   * → `activateChildRoutes(...)` → `advanceActivatedRoute(子路由)`。
   * 所以在這個函式第一次被呼叫的當下（欄位初始化，見 `activeTab` 的 `initialValue`），
   * `route.firstChild` 已經存在但**它的 `snapshot` 還是 undefined** —— 讀它會丟
   * `TypeError`，讓 `activateWith` 整個炸掉、導航被中止，而前一頁已經被拆掉了：
   * 畫面全白、網址原地不動。整頁載入時看不到，因為那時 outlet 還沒建好，
   * 元件改由 `RouterOutlet.ngOnInit` 在整棵樹 advance 完之後才建。
   *
   * `this.route.snapshot` 則在建構前就被 advance 過，而 snapshot 子樹是在 recognize
   * 階段連 redirect 一起解完的 —— 所以這裡拿到的是**網址真正指的那個分頁**，
   * 不必退回第一個。`firstChild` 為 null 的退路留給沒有子路由的情況。
   */
  private currentTab(): string {
    return this.route.snapshot.firstChild?.routeConfig?.path ?? this.tabs[0].value;
  }
}
