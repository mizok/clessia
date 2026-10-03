import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AuthService, type UserRole } from './auth.service';
import { NavigationService } from './navigation.service';
import { RoutesCatalog } from './smart-enums/routes-catalog';

/**
 * 選單過濾的第二個維度：角色之外還有細部權限。
 *
 * 金流路由在後端是 `mount(..., ADMIN_ONLY, 'manage_finance')` —— 沒有那個權限的管理員
 * 打 API 一定拿 403。前端這層不是安全邊界（真正的把關在 Hono middleware），
 * 它只是**不要讓人點到必然失敗的按鈕**。
 */
function setup(permissions: string[], role: UserRole = 'admin') {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AuthService,
        useValue: {
          activeRole: signal<UserRole | null>(role),
          hasPermission: (p: string) => permissions.includes(p) || permissions.includes('*'),
        },
      },
    ],
  });
  return TestBed.inject(NavigationService);
}

const permissioned = RoutesCatalog.values.filter((r) => r.showInMenu && r.permission);

describe('NavigationService —— 細部權限過濾', () => {
  it('有帶 permission 的選單項存在（否則這組測試是空跑）', () => {
    expect(permissioned.length).toBeGreaterThan(0);
  });

  it.each(permissioned.map((r) => [r.label, r.permission!] as const))(
    '沒有 %s 需要的 %s 權限就看不到這個項目',
    (label, _permission) => {
      const nav = setup([]);

      expect(nav.navItems().map((i) => i.label)).not.toContain(label);
    },
  );

  it.each(permissioned.map((r) => [r.label, r.permission!] as const))(
    '有 %s 需要的 %s 權限就看得到',
    (label, permission) => {
      const nav = setup([permission]);

      expect(nav.navItems().map((i) => i.label)).toContain(label);
    },
  );

  it('沒有 permission 欄位的項目不受影響 —— 零權限也看得到', () => {
    const nav = setup([]);
    const open = RoutesCatalog.values.filter(
      (r) => r.showInMenu && !r.permission && r.role?.role === 'admin',
    );

    expect(open.length).toBeGreaterThan(0);
    for (const route of open) {
      expect(nav.navItems().map((i) => i.label)).toContain(route.label);
    }
  });

  it('萬用權限 `*` 看得到全部', () => {
    const nav = setup(['*']);

    expect(nav.navItems().length).toBe(
      RoutesCatalog.values.filter((r) => r.showInMenu && r.role?.role === 'admin').length,
    );
  });
});

/**
 * A6 頂欄（#991 殼切片 S2）：選單拆成「頂欄幾項」＋「更多」分組。
 * 順序與短名照設計稿 `a6.js` 的 NAVS／MORE；兩者都從 `navItems` 衍生，所以權限過濾不會掉。
 */
describe('NavigationService —— 頂欄與「更多」', () => {
  const labels = (items: { label: string }[]) => items.map((i) => i.label);
  const groupLabels = (nav: NavigationService) => nav.moreGroups().map((g) => g.label);

  it('管理員：頂欄是 儀表板／學生／課表／帳單，「更多」照分組、通知中心在最後無標題組', () => {
    const nav = setup(['*']);

    expect(labels(nav.topItems())).toEqual(['儀表板', '學生', '課表', '帳單']);
    expect(groupLabels(nav)).toEqual([
      '課務管理',
      '學務管理',
      '考務與成績',
      '行政財務',
      '人事管理',
      '系統設定',
      undefined,
    ]);
    // 已在頂欄的（課堂管理＝課表）不重複
    expect(labels(nav.moreGroups()[0].items)).toEqual(['課程管理', '課務異動']);
    expect(labels(nav.moreGroups().at(-1)!.items)).toEqual(['通知中心']);
  });

  it('管理員沒有 manage_finance／manage_staff：頂欄少「帳單」，「更多」沒有對應分組', () => {
    const nav = setup(['view_reports']);

    expect(labels(nav.topItems())).toEqual(['儀表板', '學生', '課表']);
    expect(groupLabels(nav)).not.toContain('人事管理');
    expect(
      nav
        .moreGroups()
        .find((g) => g.label === '行政財務')!
        .items.map((i) => i.label),
    ).toEqual(['營收報表']);
  });

  it('老師：頂欄 課表／學生／通知，沒有「更多」', () => {
    const nav = setup([], 'teacher');

    expect(labels(nav.topItems())).toEqual(['課表', '學生', '通知']);
    expect(nav.moreGroups()).toEqual([]);
  });

  it('家長：頂欄 首頁／到班／成績／繳費，「更多」是 學習狀況／生活與繳費／行政服務／通知中心', () => {
    const nav = setup([], 'parent');

    expect(labels(nav.topItems())).toEqual(['首頁', '到班', '成績', '繳費']);
    expect(groupLabels(nav)).toEqual(['學習狀況', '生活與繳費', '行政服務', undefined]);
  });

  it.each<[UserRole, string[]]>([
    ['admin', ['*']],
    ['admin', []],
    ['teacher', []],
    ['parent', []],
  ])('%s（權限 %j）：頂欄＋「更多」＝原本的選單，不多不少不重複', (role, permissions) => {
    const nav = setup(permissions, role);
    const split = [...nav.topItems(), ...nav.moreGroups().flatMap((g) => g.items)].map(
      (i) => i.route,
    );

    expect(split.length).toBe(new Set(split).size);
    expect([...split].sort()).toEqual(
      nav
        .navItems()
        .map((i) => i.route)
        .sort(),
    );
  });
});
