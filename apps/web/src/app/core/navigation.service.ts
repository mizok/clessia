import { Injectable, computed, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { RoutesCatalog } from './smart-enums/routes-catalog';

export interface NavItem {
  readonly label: string;
  readonly icon: string;
  readonly route: string;
  readonly group?: string;
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
      .map((path) => ({
        label: path.label,
        icon: path.icon,
        route: path.absolutePath,
        group: path.group,
      }));
  });
}
