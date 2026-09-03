import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter, type Route } from '@angular/router';

import { AuthService, type UserRole } from '@core/auth.service';

import { routes } from './app.routes';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

/**
 * 選單項目必須真的打得開。
 *
 * 這組測試存在的原因：`/admin/changes` 曾經同時是「選單上看得到」與「路由 redirect 到別頁」——
 * 頁面元件寫好了、選單開了，點下去卻被彈到課堂管理，而所有既有測試都是綠的。
 * 元件測試測不到這件事，因為它跟元件無關；它是選單與路由表之間的縫。
 */

function flatten(list: readonly Route[], prefix = ''): Array<{ path: string; route: Route }> {
  return list.flatMap((route) => {
    const path = [prefix, route.path ?? ''].filter(Boolean).join('/');
    const self = route.path === undefined ? [] : [{ path, route }];
    return [...self, ...flatten(route.children ?? [], path)];
  });
}

const allRoutes = flatten(routes);

/** 選單上看得到的項目 */
const menuEntries = RoutesCatalog.values.filter((entry) => entry.showInMenu);

describe('app routes', () => {
  it('選單上不是空的', () => {
    expect(menuEntries.length).toBeGreaterThan(0);
  });

  it.each(menuEntries.map((entry) => [entry.label, entry.absolutePath] as const))(
    '「%s」(%s) 在路由表裡有對應的項目',
    (_label, absolutePath) => {
      const target = absolutePath.replace(/^\//, '');

      expect(allRoutes.map((r) => r.path)).toContain(target);
    },
  );

  // 分校/學校/科目 從側欄收進 /admin/settings 的四個 tab（PR #G）。
  // 它們不再 showInMenu，所以上面兩個 it.each 管不到 —— 但別人存的書籤還在。
  describe('設定四頁：收進 tab 之後的可達性', () => {
    it.each([
      [RoutesCatalog.ADMIN_CAMPUSES],
      [RoutesCatalog.ADMIN_SCHOOLS],
      [RoutesCatalog.ADMIN_SUBJECTS],
      [RoutesCatalog.ADMIN_SETTINGS_GENERAL],
    ])('$absolutePath 載入得到頁面', (entry) => {
      const target = entry.absolutePath.replace(/^\//, '');
      const matches = allRoutes.filter((r) => r.path === target);

      expect(
        matches.some(({ route }) => !route.redirectTo && (route.loadComponent ?? route.component)),
      ).toBe(true);
    });

    // 舊網址 404 的話，別人存的書籤與外部連結會直接死掉
    it.each([['campuses'], ['schools'], ['subjects']])(
      '舊網址 /admin/%s 是 redirect，不是 404',
      (segment) => {
        const old = allRoutes.find((r) => r.path === `admin/${segment}`);

        expect(old?.route.redirectTo).toBe(`settings/${segment}`);
      },
    );

    it('側欄只留一項「系統設定」', () => {
      const settingsMenuItems = menuEntries.filter((e) =>
        e.absolutePath.startsWith('/admin/settings'),
      );

      expect(settingsMenuItems.map((e) => e.label)).toEqual(['系統設定']);
    });
  });

  it.each(menuEntries.map((entry) => [entry.label, entry.absolutePath] as const))(
    '「%s」(%s) 載入的是頁面，不是 redirect',
    (_label, absolutePath) => {
      const target = absolutePath.replace(/^\//, '');
      // 同一個路徑可能有多個項目：父層只負責分組、真正的頁面掛在 path: '' 的子路由上
      const matches = allRoutes.filter((r) => r.path === target);
      const reachable = matches.some(
        ({ route }) => !route.redirectTo && (route.loadComponent ?? route.component),
      );

      expect(reachable).toBe(true);
    },
  );
});

/**
 * 選單過濾與路由守衛必須守同一個權限。
 *
 * 這是坑 #1（選單與路由表之間的縫）的第二種形狀：`RouteObj.permission` 只影響選單顯示，
 * 藏起入口卻沒掛 guard 的話，使用者直接打網址還是進得去；掛錯權限則是更安靜的版本 ——
 * 兩邊都「有東西」，但守的不是同一件事。`permissionGuard` 會把權限名掛在回傳的 guard 上，
 * 讓這件事斷言得到。
 */
// 老師儀表板在 2026-09 的「今日流」收斂裡刪掉了 —— 它獨有的只有四個數字與兩個連結，
// 而「今日課表」清單跟課表今天那一屏完全重複。跟設定四頁同一個處理：頁面沒了、網址還在。
describe('老師儀表板刪除之後', () => {
  it('/teacher/dashboard 是 redirect，不是 404 —— 老師可能存了書籤', () => {
    const entry = allRoutes.find((r) => r.path === 'teacher/dashboard');

    expect(entry).toBeDefined();
    expect(entry?.route.redirectTo).toBe('schedule');
    expect(entry?.route.loadComponent ?? entry?.route.component).toBeUndefined();
  });

  it('不再出現在選單裡', () => {
    expect(menuEntries.map((e) => e.absolutePath)).not.toContain('/teacher/dashboard');
  });

  /** 刪一頁之後底部導覽從 4 個變 3 個；超過 4 個才會出現「更多」，所以不該有 */
  it('老師選單剩三項', () => {
    const teacherItems = menuEntries.filter((e) => e.absolutePath.startsWith('/teacher/'));

    expect(teacherItems.map((e) => e.absolutePath).sort()).toEqual([
      '/teacher/notifications',
      '/teacher/schedule',
      '/teacher/students',
    ]);
  });
});

describe('app routes —— 帶 permission 的路由必須掛對 guard', () => {
  const permissioned = RoutesCatalog.values.filter((entry) => entry.permission);

  it('有帶 permission 的路由存在（否則這組測試是空跑）', () => {
    expect(permissioned.length).toBeGreaterThan(0);
  });

  it.each(
    permissioned.map((entry) => [entry.label, entry.absolutePath, entry.permission!] as const),
  )('「%s」(%s) 掛了 permissionGuard(%s)', (_label, absolutePath, permission) => {
    const target = absolutePath.replace(/^\//, '');
    const guards = allRoutes
      .filter((r) => r.path === target)
      .flatMap(({ route }) => route.canActivate ?? []);

    expect(guards.map((g) => (g as { permission?: string }).permission)).toContain(permission);
  });
});

/**
 * `/select-role` 是三個 guard 與 LINE 登入 callback 的共同去處
 * （guest.guard、role.guard、auth.service 的 callbackURL）。
 * 它一旦沒有註冊，就會被 `path: '**'` 收去 `/login`，而 guestGuard 又會把
 * 已登入的多角色使用者送回 `/select-role` —— 兩邊互踢。
 */
describe('app.routes —— /select-role 的可達性', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            // guard 問的是這支（它自己保證等首次載入完成），不是 loading + isAuthenticated
            isAuthenticatedWhenReady: async () => true,
            isAuthenticated: signal(true),
            roles: signal<UserRole[]>(['admin', 'teacher']),
            activeRole: signal<UserRole | null>(null),
            profile: signal({ id: 'u1', display_name: '王主任', branch_id: null }),
            user: signal({ id: 'u1', email: 'a@example.com' }),
            navigateToRoleShell: vi.fn(),
            signOut: vi.fn(),
          },
        },
      ],
    });
    router = TestBed.inject(Router);
  });

  it('已登入時 /select-role 停得住，不會被 wildcard 導走', async () => {
    await router.navigateByUrl('/select-role');

    expect(router.url).toBe('/select-role');
  });
});
