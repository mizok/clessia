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
  let firstChild: { snapshot: { routeConfig: { path: string } | null } } | null;

  async function setup(currentPath: string | null = 'campuses') {
    firstChild = currentPath === null ? null : { snapshot: { routeConfig: { path: currentPath } } };
    routerMock.navigate.mockReset();

    await TestBed.configureTestingModule({
      imports: [SettingsShellPage],
      providers: [
        { provide: Router, useValue: routerMock },
        {
          provide: ActivatedRoute,
          useValue: {
            get firstChild() {
              return firstChild;
            },
          },
        },
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

    firstChild = { snapshot: { routeConfig: { path: 'general' } } };
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
