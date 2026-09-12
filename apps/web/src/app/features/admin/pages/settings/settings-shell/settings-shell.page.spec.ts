import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { Subject } from 'rxjs';
import { vi } from 'vitest';

import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

import { SettingsShellPage } from './settings-shell.page';

// jsdom 沒有 ResizeObserver，而 p-tablist 在 ngAfterViewInit 就會 new 一個。
// 專案其他用 p-tabs 的頁面是條件渲染（測試裡剛好沒渲染到），這裡的 tab 列永遠在。
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as never;
});

describe('SettingsShellPage', () => {
  let fixture: ComponentFixture<SettingsShellPage>;
  let component: SettingsShellPage;

  const events = new Subject<unknown>();
  const routerMock = { events, navigate: vi.fn(), url: '/admin/settings/campuses' };

  let tabPath: string | null;
  let childAdvanced: boolean;

  /**
   * router 的活化順序（`@angular/router` 的 `activateRoutes`）：
   * `advanceActivatedRoute(殼)` → `outlet.activateWith(殼)`（**元件在這裡建構**）
   * → `activateChildRoutes(...)` → `advanceActivatedRoute(子路由)`。
   *
   * 也就是**殼建構完之後，子路由的 `snapshot` 才被填上** —— 所以這個 mock 用
   * `childAdvanced` 分成兩階段：`false` 是 SPA 導航建構當下（#804 炸掉的那一刻），
   * `true` 是活化跑完之後。殼自己的 `snapshot` 兩階段都在（它先被 advance 過），
   * 而它的 snapshot 子樹在 recognize 階段就齊了。
   */
  const routeMock = {
    get snapshot() {
      return { firstChild: tabPath === null ? null : { routeConfig: { path: tabPath } } };
    },
    get firstChild() {
      if (tabPath === null) return null;
      return { snapshot: childAdvanced ? { routeConfig: { path: tabPath } } : undefined };
    },
  };

  async function setup(currentPath: string | null = 'campuses', advanced = true) {
    tabPath = currentPath;
    childAdvanced = advanced;
    routerMock.navigate.mockReset();

    await TestBed.configureTestingModule({
      imports: [SettingsShellPage],
      providers: [
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: routeMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsShellPage);
    fixture.componentRef.setInput('page', RoutesCatalog.ADMIN_SETTINGS);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  // 這頁原本直接從 tabs 開始，沒有頁標——全站唯一（Tester #15）
  it('有頁標，不是直接從 tabs 開始', async () => {
    await setup('subjects');

    const title = fixture.nativeElement.querySelector('.settings-shell__title');
    expect(title?.textContent?.trim()).toBe(RoutesCatalog.ADMIN_SETTINGS.label);
  });

  it('當前 tab 讀的是 URL，不是本地狀態', async () => {
    await setup('subjects');

    expect(component['activeTab']()).toBe('subjects');
  });

  // #804：從 app 內 SPA 導航進來時，殼建構在子路由 advance 之前 ——
  // `route.firstChild.snapshot` 是 undefined，讀它會讓整個導航被中止、畫面空白。
  // 斷言不只是「不要炸」：tab 必須是**網址真正指的那一個**，不是退回第一個。
  it('SPA 導航建構時子路由還沒 advance，仍讀到網址指的 tab', async () => {
    await setup('general', false);

    expect(component['activeTab']()).toBe('general');
  });

  // 進 /admin/settings 時 redirect 還沒跑完，firstChild 是空的
  it('子路由還沒解析時先給第一個 tab，不是空值', async () => {
    await setup(null);

    expect(component['activeTab']()).toBe('campuses');
  });

  it('切 tab 是導航，不是切本地變數', async () => {
    await setup('campuses');

    component['onTabChange']('schools');

    expect(routerMock.navigate).toHaveBeenCalledWith(['schools'], expect.anything());
  });

  // p-tabs 的 valueChange 型別帶 undefined —— 送出去會導到 /admin/settings/undefined
  it('valueChange 給 undefined 時不導航', async () => {
    await setup('campuses');

    component['onTabChange'](undefined);

    expect(routerMock.navigate).not.toHaveBeenCalled();
  });

  it('導航之後 tab 跟著換 —— 瀏覽器上一頁也要對', async () => {
    await setup('campuses');

    tabPath = 'general';
    events.next(new NavigationEnd(1, '/admin/settings/general', '/admin/settings/general'));
    fixture.detectChanges();

    expect(component['activeTab']()).toBe('general');
  });

  it('四個 tab 的 value 對得上 RoutesCatalog 的 relativePath', async () => {
    await setup();

    expect(component['tabs'].map((t) => t.value)).toEqual([
      RoutesCatalog.ADMIN_CAMPUSES.relativePath,
      RoutesCatalog.ADMIN_SCHOOLS.relativePath,
      RoutesCatalog.ADMIN_SUBJECTS.relativePath,
      RoutesCatalog.ADMIN_SETTINGS_GENERAL.relativePath,
    ]);
  });
});
