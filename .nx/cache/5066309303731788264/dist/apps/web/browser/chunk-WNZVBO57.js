import {
  RoutesCatalog
} from "./chunk-6PJ7S3AC.js";
import {
  AuthService
} from "./chunk-IDX5LEWH.js";
import {
  Injectable,
  computed,
  inject,
  setClassMetadata,
  ɵɵdefineInjectable
} from "./chunk-YGF3CXFR.js";

// apps/web/src/app/core/navigation.service.ts
var NavigationService = class _NavigationService {
  auth = inject(AuthService);
  navItems = computed(() => {
    const role = this.auth.activeRole();
    if (!role)
      return [];
    return RoutesCatalog.values.filter((path) => !!path.role && path.role.role === role && path.showInMenu).map((path) => ({
      label: path.label,
      icon: path.icon,
      route: path.absolutePath,
      group: path.group
    }));
  }, ...ngDevMode ? [{ debugName: "navItems" }] : []);
  static \u0275fac = function NavigationService_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _NavigationService)();
  };
  static \u0275prov = /* @__PURE__ */ \u0275\u0275defineInjectable({ token: _NavigationService, factory: _NavigationService.\u0275fac, providedIn: "root" });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(NavigationService, [{
    type: Injectable,
    args: [{
      providedIn: "root"
    }]
  }], null, null);
})();

export {
  NavigationService
};
//# sourceMappingURL=chunk-WNZVBO57.js.map
