import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { vi } from 'vitest';

import { CampusesService, type Campus } from '@core/campuses.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { SchoolsService } from '@core/schools.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { SubjectsService } from '@core/subjects.service';

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

  const campus = (over: Partial<Campus>): Campus =>
    ({ id: 'c', name: '分校', isActive: true, attendanceMode: null, ...over }) as Campus;
  let campusList: ReturnType<typeof vi.fn>;
  const orgSettings = signal<{ attendanceMode: 'per_session' | 'daily_checkin' } | null>(null);

  async function setup(
    currentPath: string | null = 'campuses',
    advanced = true,
    data: Campus[] | null = null,
  ) {
    tabPath = currentPath;
    childAdvanced = advanced;
    routerMock.navigate.mockReset();
    orgSettings.set({ attendanceMode: 'daily_checkin' });
    campusList = vi.fn(() =>
      data
        ? of({ data, summary: { total: data.length, activeCount: 0, inactiveCount: 0 }, meta: {} })
        : throwError(() => new Error('offline')),
    );

    await TestBed.configureTestingModule({
      imports: [SettingsShellPage],
      providers: [
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: routeMock },
        { provide: CampusesService, useValue: { list: campusList } },
        {
          provide: SchoolsService,
          useValue: { list: () => of({ data: [], meta: { total: 128 } }) },
        },
        { provide: SubjectsService, useValue: { list: () => of({ data: [{}, {}, {}] }) } },
        {
          provide: OrgSettingsService,
          useValue: { settings: orgSettings, status: () => 'ready', load: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsShellPage);
    fixture.componentRef.setInput('page', RoutesCatalog.ADMIN_SETTINGS);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  // 這頁原本直接從 tabs 開始，沒有頁標——全站唯一（Tester #15）；分校讀不到時退回頁名
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

    expect(component['activeTab']()).toBe('general');
  });

  const link = (tab: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      `a[data-tab="${tab}"]`,
    )!;

  it('切分頁是導航，不是切本地變數；連結是真網址', async () => {
    await setup('campuses');

    expect(link('schools').getAttribute('href')).toBe('/admin/settings/schools');
    link('schools').click();

    expect(routerMock.navigate).toHaveBeenCalledWith(['schools'], expect.anything());
  });

  // 連結是真網址：⌘／Ctrl 點擊要開新分頁，app 不攔
  it('⌘／Ctrl 點擊交給瀏覽器，不在 app 內導航', async () => {
    await setup('campuses');

    const e = new MouseEvent('click', { metaKey: true, bubbles: true, cancelable: true });
    link('schools').dispatchEvent(e);

    expect(routerMock.navigate).not.toHaveBeenCalled();
  });

  it('A6 順序「一般、分校、學校、科目」；當前分頁 aria-current；分校／學校／科目帶筆數', async () => {
    await setup('schools', true, [campus({ id: 'a' }), campus({ id: 'b' })]);

    const tabs = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('nav[aria-label="系統設定"] a'),
    ];
    expect(tabs.map((a) => a.textContent!.replace(/\s+/g, ''))).toEqual([
      '一般',
      '分校2',
      '學校128',
      '科目3',
    ]);
    expect(link('schools').getAttribute('aria-current')).toBe('page');
    expect(link('general').getAttribute('aria-current')).toBeNull();
  });

  it('0 筆也寫 0（不是不顯示）', async () => {
    await setup('general', true, []);
    expect(link('campuses').textContent!.replace(/\s+/g, '')).toBe('分校0');
  });

  describe('色面標題（A6：分校怎麼在營運）', () => {
    const title = () =>
      (fixture.nativeElement as HTMLElement).querySelector('h1')!.textContent!.replace(/\s+/g, '');

    it('全部日到班（沒設的沿用機構預設）；停用的不算', async () => {
      await setup('general', true, [
        campus({ id: 'a' }),
        campus({ id: 'b', attendanceMode: 'daily_checkin' }),
        campus({ id: 'off', isActive: false, attendanceMode: 'per_session' }),
      ]);
      expect(title()).toBe('2個分校在營運，全部用日到班。');
    });

    it('混用：寫幾個用日到班', async () => {
      await setup('general', true, [
        campus({ id: 'a' }),
        campus({ id: 'b', attendanceMode: 'per_session' }),
        campus({ id: 'c', attendanceMode: 'per_session' }),
      ]);
      expect(title()).toBe('3個分校在營運，1個用日到班。');
    });

    it('全部隨堂點名', async () => {
      await setup('general', true, [campus({ id: 'a', attendanceMode: 'per_session' })]);
      expect(title()).toBe('1個分校在營運，全部用隨堂點名。');
    });

    it('機構預設還沒讀到、又有沒設模式的分校：只寫在營運幾個，不猜', async () => {
      await setup('general', true, [campus({ id: 'a' })]);
      orgSettings.set(null);
      fixture.detectChanges();
      expect(title()).toBe('1個分校在營運。');
    });

    it('切分頁後重抓（別的分頁新增、停用之後標題跟著對）', async () => {
      await setup('general', true, [campus({ id: 'a' })]);
      const before = campusList.mock.calls.length;
      events.next(new NavigationEnd(2, '/admin/settings/campuses', '/admin/settings/campuses'));
      expect(campusList.mock.calls.length).toBe(before + 1);
    });
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
      RoutesCatalog.ADMIN_SETTINGS_GENERAL.relativePath,
      RoutesCatalog.ADMIN_CAMPUSES.relativePath,
      RoutesCatalog.ADMIN_SCHOOLS.relativePath,
      RoutesCatalog.ADMIN_SUBJECTS.relativePath,
    ]);
  });
});
