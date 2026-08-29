import { Injectable, computed, inject } from '@angular/core';
import { AuthService } from './auth.service';
import type { NavigationGroup } from './smart-enums/navigation-group';
import { RoutesCatalog } from './smart-enums/routes-catalog';

export interface NavItem {
  readonly label: string;
  readonly icon: string;
  readonly route: string;
  readonly group?: NavigationGroup;
  readonly badge?: number;
}

@Injectable({
  providedIn: 'root',
})
export class NavigationService {
  private readonly auth = inject(AuthService);

  readonly navItems = computed<NavItem[]>(() => {
    const role = this.auth.activeRole();
    if (!role) return [];

    return RoutesCatalog.values
      .filter((path) => !!path.role && path.role.role === role && path.showInMenu)
      // 細部權限：沒有的話連入口都不顯示。這不是安全邊界（那在 Hono middleware），
      // 只是不要讓人點到必然 403 的按鈕。路由上還有 permissionGuard 擋直接打網址。
      .filter((path) => !path.permission || this.auth.hasPermission(path.permission))
      .map((path) => ({
        label: path.label,
        icon: path.icon,
        route: path.absolutePath,
        group: path.group,
      }));
  });
}
