import {
  SupabaseService
} from "./chunk-WSLHL2JA.js";
import {
  Router
} from "./chunk-NFVC465N.js";
import {
  Injectable,
  computed,
  setClassMetadata,
  signal,
  ɵɵdefineInjectable,
  ɵɵinject
} from "./chunk-YGF3CXFR.js";

// apps/web/src/app/core/auth.service.ts
var AuthService = class _AuthService {
  supabaseService;
  router;
  _user = signal(null, ...ngDevMode ? [{ debugName: "_user" }] : []);
  _profile = signal(null, ...ngDevMode ? [{ debugName: "_profile" }] : []);
  _roles = signal([], ...ngDevMode ? [{ debugName: "_roles" }] : []);
  _permissions = signal([], ...ngDevMode ? [{ debugName: "_permissions" }] : []);
  _activeRole = signal(null, ...ngDevMode ? [{ debugName: "_activeRole" }] : []);
  _loading = signal(true, ...ngDevMode ? [{ debugName: "_loading" }] : []);
  _showRolePicker = signal(false, ...ngDevMode ? [{ debugName: "_showRolePicker" }] : []);
  user = this._user.asReadonly();
  profile = this._profile.asReadonly();
  roles = this._roles.asReadonly();
  permissions = this._permissions.asReadonly();
  activeRole = this._activeRole.asReadonly();
  loading = this._loading.asReadonly();
  isAuthenticated = computed(() => !!this._user(), ...ngDevMode ? [{ debugName: "isAuthenticated" }] : []);
  showRolePicker = this._showRolePicker.asReadonly();
  supabase;
  constructor(supabaseService, router) {
    this.supabaseService = supabaseService;
    this.router = router;
    this.supabase = this.supabaseService.client;
    this.init();
  }
  async init() {
    const { data: { session } } = await this.supabase.auth.getSession();
    if (session?.user) {
      this._user.set(session.user);
      await this.loadProfile(session.user.id);
    }
    this._loading.set(false);
    this.supabase.auth.onAuthStateChange((_event, session2) => {
      this._user.set(session2?.user ?? null);
      if (session2?.user) {
        void this.loadProfile(session2.user.id);
      } else {
        this._profile.set(null);
        this._roles.set([]);
        this._permissions.set([]);
        this._activeRole.set(null);
        localStorage.removeItem("clessia:active-role");
      }
    });
  }
  async loadProfile(userId) {
    const [profileResult, rolesResult] = await Promise.all([
      this.supabase.from("profiles").select("id, display_name, branch_id").eq("id", userId).single(),
      this.supabase.from("user_roles").select("role, permissions").eq("user_id", userId)
    ]);
    this._profile.set(profileResult.data);
    const roles = [];
    const allPermissions = /* @__PURE__ */ new Set();
    (rolesResult.data ?? []).forEach((r) => {
      roles.push(r.role);
      if (r.permissions && Array.isArray(r.permissions)) {
        r.permissions.forEach((p) => allPermissions.add(p));
      }
    });
    this._roles.set(roles);
    this._permissions.set(Array.from(allPermissions));
    if (roles.length === 1) {
      this._activeRole.set(roles[0]);
    } else {
      const savedRole = localStorage.getItem("clessia:active-role");
      if (savedRole && roles.includes(savedRole)) {
        this._activeRole.set(savedRole);
      }
    }
  }
  setActiveRole(role) {
    this._activeRole.set(role);
    localStorage.setItem("clessia:active-role", role);
  }
  hasPermission(permission) {
    return this.permissions().includes(permission) || this.permissions().includes("*");
  }
  openRolePicker() {
    this._showRolePicker.set(true);
  }
  closeRolePicker() {
    this._showRolePicker.set(false);
  }
  async signIn(email, password, captchaToken) {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken }
    });
    if (error)
      return "\u5E33\u865F\u6216\u5BC6\u78BC\u932F\u8AA4";
    if (data.user) {
      this._user.set(data.user);
      await this.loadProfile(data.user.id);
    }
    return null;
  }
  shellMap = {
    admin: "/admin",
    teacher: "/teacher",
    parent: "/parent"
  };
  navigateToRoleShell(role) {
    this.setActiveRole(role);
    this.closeRolePicker();
    this.router.navigate([this.shellMap[role]]);
  }
  setRememberMe(value) {
    localStorage.setItem("clessia:remember-me", String(value));
  }
  async sendPasswordReset(email, captchaToken) {
    const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
      captchaToken
    });
    return error?.message ?? null;
  }
  async updatePassword(newPassword) {
    const { error } = await this.supabase.auth.updateUser({ password: newPassword });
    return error?.message ?? null;
  }
  async signOut() {
    this.closeRolePicker();
    await this.supabase.auth.signOut();
    this._user.set(null);
    this._profile.set(null);
    this._roles.set([]);
    this._permissions.set([]);
    this._activeRole.set(null);
    this.router.navigate(["/login"]);
  }
  static \u0275fac = function AuthService_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _AuthService)(\u0275\u0275inject(SupabaseService), \u0275\u0275inject(Router));
  };
  static \u0275prov = /* @__PURE__ */ \u0275\u0275defineInjectable({ token: _AuthService, factory: _AuthService.\u0275fac, providedIn: "root" });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(AuthService, [{
    type: Injectable,
    args: [{ providedIn: "root" }]
  }], () => [{ type: SupabaseService }, { type: Router }], null);
})();

export {
  AuthService
};
//# sourceMappingURL=chunk-IDX5LEWH.js.map
