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
function setup(permissions: string[]) {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AuthService,
        useValue: {
          activeRole: signal<UserRole | null>('admin'),
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
