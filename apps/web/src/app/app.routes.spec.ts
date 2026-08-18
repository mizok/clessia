import type { Route } from '@angular/router';

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
