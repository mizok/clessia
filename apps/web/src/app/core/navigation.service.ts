import { Injectable, computed, inject } from '@angular/core';
import { AuthService, type UserRole } from './auth.service';
import { NavigationGroup } from './smart-enums/navigation-group';
import { RoutesCatalog, type RouteObj } from './smart-enums/routes-catalog';

export interface NavItem {
  readonly label: string;
  readonly icon: string;
  readonly route: string;
  readonly group?: NavigationGroup;
  readonly badge?: number;
}

export interface NavGroup {
  /** 沒有標題的那一組（通知中心）排最後 */
  readonly label?: string;
  readonly items: NavItem[];
}

/**
 * A6 頂欄（#991 殼切片 S2）：每個角色常用的幾項，**順序與短名照設計稿**（`a6.js` 的 NAVS）——
 * 跟 catalog 的宣告順序不同（管理員是「學生」在「課表」前），所以獨立寫一份而不是在 RouteObj 加欄位。
 * 引用 RouteObj 不寫路徑字串：路由改名或刪掉會編不過，不會靜靜腐化（c11）。
 * 儀表板放第一項（字標也連到它），「更多」就不再列。
 */
const TOP_NAV: Record<UserRole, readonly (readonly [RouteObj, string])[]> = {
  admin: [
    [RoutesCatalog.ADMIN_DASHBOARD, '儀表板'],
    [RoutesCatalog.ADMIN_STUDENTS, '學生'],
    [RoutesCatalog.ADMIN_SESSIONS, '課表'],
    [RoutesCatalog.ADMIN_PAYMENTS, '帳單'],
  ],
  teacher: [
    [RoutesCatalog.TEACHER_SCHEDULE, '課表'],
    [RoutesCatalog.TEACHER_STUDENTS, '學生'],
    [RoutesCatalog.TEACHER_NOTIFICATIONS, '通知'],
  ],
  parent: [
    [RoutesCatalog.PARENT_DASHBOARD, '首頁'],
    [RoutesCatalog.PARENT_ATTENDANCE, '到班'],
    [RoutesCatalog.PARENT_GRADES, '成績'],
    [RoutesCatalog.PARENT_PAYMENTS, '繳費'],
  ],
  // 機台不掛 ShellLayout，沒有頂欄（#1127）
  kiosk: [],
};

@Injectable({
  providedIn: 'root',
})
export class NavigationService {
  private readonly auth = inject(AuthService);

  readonly navItems = computed<NavItem[]>(() => {
    const role = this.auth.activeRole();
    if (!role) return [];

    return (
      RoutesCatalog.values
        .filter((path) => !!path.role && path.role.role === role && path.showInMenu)
        // 細部權限：沒有的話連入口都不顯示。這不是安全邊界（那在 Hono middleware），
        // 只是不要讓人點到必然 403 的按鈕。路由上還有 permissionGuard 擋直接打網址。
        .filter((path) => !path.permission || this.auth.hasPermission(path.permission))
        .map((path) => ({
          label: path.label,
          icon: path.icon,
          route: path.absolutePath,
          group: path.group,
        }))
    );
  });

  /** 頂欄。從 `navItems` 挑，所以沒有權限的項目（例如沒有 manage_finance 的「帳單」）自然不在。 */
  readonly topItems = computed<NavItem[]>(() => {
    const role = this.auth.activeRole();
    if (!role) return [];
    const items = this.navItems();
    return TOP_NAV[role].flatMap(([route, label]) => {
      const item = items.find((i) => i.route === route.absolutePath);
      return item ? [{ ...item, label }] : [];
    });
  });

  /** 「更多」：頂欄以外的項目，依 NavigationGroup 宣告順序分組；沒有分組的排最後一組。 */
  readonly moreGroups = computed<NavGroup[]>(() => {
    const top = new Set(this.topItems().map((i) => i.route));
    const rest = this.navItems().filter((i) => !top.has(i.route));
    const groups: NavGroup[] = NavigationGroup.values
      .map((g) => ({ label: g.label, items: rest.filter((i) => i.group === g) }))
      .filter((g) => g.items.length > 0);
    const loose = rest.filter((i) => !i.group);
    return loose.length > 0 ? [...groups, { items: loose }] : groups;
  });
}
