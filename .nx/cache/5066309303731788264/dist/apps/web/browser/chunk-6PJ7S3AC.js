// apps/web/src/app/core/smart-enums/user-type.ts
var UserType = class _UserType {
  role;
  label;
  description;
  static values = [];
  constructor(role, label, description) {
    this.role = role;
    this.label = label;
    this.description = description;
    _UserType.values.push(this);
  }
  static findByRole(role) {
    return this.values.find((u) => u.role === role);
  }
  static ADMIN = new _UserType("admin", "\u7BA1\u7406\u54E1");
  static TEACHER = new _UserType("teacher", "\u8001\u5E2B");
  static PARENT = new _UserType("parent", "\u5BB6\u9577");
};

// apps/web/src/app/core/smart-enums/routes-catalog.ts
var RouteObj = class {
  relativePath;
  absolutePath;
  label;
  role;
  icon;
  showInMenu;
  group;
  constructor(relativePath, absolutePath, label, role, icon, showInMenu = true, group) {
    this.relativePath = relativePath;
    this.absolutePath = absolutePath;
    this.label = label;
    this.role = role;
    this.icon = icon;
    this.showInMenu = showInMenu;
    this.group = group;
  }
};
var RoutesCatalog = class {
  static values = [];
  // Public
  static PUBLIC_LOGIN = this.register("login", "/login", "\u767B\u5165", void 0, "pi-sign-in");
  static PUBLIC_TRIAL = this.register("trial", "/trial", "\u8A66\u807D\u7533\u8ACB", void 0, "pi-headphones");
  static PUBLIC_ENROLLMENT = this.register("enrollment", "/enrollment", "\u6211\u8981\u5831\u540D", void 0, "pi-file-edit");
  static PUBLIC_CHECKIN = this.register("qr-checkin", "/qr-checkin", "QR \u5230\u73ED\u6253\u5361", void 0, "pi-qrcode");
  static PUBLIC_FORGOT_PASSWORD = this.register("forgot-password", "/forgot-password", "\u5FD8\u8A18\u5BC6\u78BC", void 0, "pi-key", false);
  static PUBLIC_RESET_PASSWORD = this.register("reset-password", "/reset-password", "\u91CD\u8A2D\u5BC6\u78BC", void 0, "pi-key", false);
  static PUBLIC_CHANGE_PASSWORD = this.register("change-password", "/change-password", "\u8B8A\u66F4\u5BC6\u78BC", void 0, "pi-key", false);
  // Admin
  static ADMIN_ROOT = this.register("admin", "/admin", "\u7BA1\u7406\u54E1", UserType.ADMIN, "pi-shield", false);
  // Ungrouped
  // Ungrouped
  static ADMIN_DASHBOARD = this.register("dashboard", "/admin/dashboard", "\u5100\u8868\u677F", UserType.ADMIN, "pi-home");
  static ADMIN_TASKS = this.register("tasks", "/admin/tasks", "\u5F85\u8655\u7406\u5DE5\u4F5C", UserType.ADMIN, "pi-list");
  static ADMIN_NOTIFICATIONS = this.register("notifications", "/admin/notifications", "\u901A\u77E5\u4E2D\u5FC3", UserType.ADMIN, "pi-bell");
  static ADMIN_CALENDAR = this.register("calendar", "/admin/calendar", "\u8AB2\u7A0B\u65E5\u66C6", UserType.ADMIN, "pi-calendar");
  // Group: 教務管理
  static ADMIN_COURSES = this.register("courses", "/admin/courses", "\u8AB2\u7A0B\u5217\u8868", UserType.ADMIN, "pi-book", true, "\u6559\u52D9\u7BA1\u7406");
  static ADMIN_CLASSES = this.register("classes", "/admin/classes", "\u958B\u8AB2\u73ED\u7BA1\u7406", UserType.ADMIN, "pi-users", true, "\u6559\u52D9\u7BA1\u7406");
  static ADMIN_SCHEDULE = this.register("schedule", "/admin/schedule", "\u6392\u8AB2\u7BA1\u7406", UserType.ADMIN, "pi-table", true, "\u6559\u52D9\u7BA1\u7406");
  static ADMIN_SESSIONS = this.register("sessions", "/admin/sessions", "\u8AB2\u5802\u641C\u5C0B", UserType.ADMIN, "pi-search", true, "\u6559\u52D9\u7BA1\u7406");
  static ADMIN_CHANGES = this.register("changes", "/admin/changes", "\u8AB2\u52D9\u7570\u52D5", UserType.ADMIN, "pi-history", true, "\u6559\u52D9\u7BA1\u7406");
  // Group: 學務管理
  static ADMIN_ENROLLMENT = this.register("enrollment", "/admin/enrollment", "\u5B78\u751F\u5831\u540D", UserType.ADMIN, "pi-user-plus", true, "\u5B78\u52D9\u7BA1\u7406");
  static ADMIN_STUDENTS = this.register("students", "/admin/students", "\u5B78\u751F\u8CC7\u6599", UserType.ADMIN, "pi-users", true, "\u5B78\u52D9\u7BA1\u7406");
  static ADMIN_PARENTS = this.register("parents", "/admin/parents", "\u5BB6\u9577\u8CC7\u6599", UserType.ADMIN, "pi-user", true, "\u5B78\u52D9\u7BA1\u7406");
  static ADMIN_ATTENDANCE = this.register("attendance", "/admin/attendance", "\u51FA\u52E4\u7D00\u9304", UserType.ADMIN, "pi-check-circle", true, "\u5B78\u52D9\u7BA1\u7406");
  static ADMIN_LEAVE = this.register("leave", "/admin/leave", "\u8ACB\u5047\u7BA1\u7406", UserType.ADMIN, "pi-file", true, "\u5B78\u52D9\u7BA1\u7406");
  static ADMIN_GRADES = this.register("grades", "/admin/grades", "\u6210\u7E3E\u67E5\u95B1", UserType.ADMIN, "pi-chart-line", true, "\u5B78\u52D9\u7BA1\u7406");
  // Group: 行政財務
  static ADMIN_FEE_TEMPLATES = this.register("fee-templates", "/admin/fee-templates", "\u8CBB\u7528\u65B9\u6848\u7BA1\u7406", UserType.ADMIN, "pi-wallet", true, "\u884C\u653F\u8CA1\u52D9");
  static ADMIN_MEALS = this.register("meals", "/admin/meals", "\u9910\u8CBB\u7BA1\u7406", UserType.ADMIN, "pi-dollar", true, "\u884C\u653F\u8CA1\u52D9");
  static ADMIN_PAYMENTS = this.register("payments", "/admin/payments", "\u7E73\u8CBB\u7D00\u9304", UserType.ADMIN, "pi-credit-card", true, "\u884C\u653F\u8CA1\u52D9");
  static ADMIN_REPORTS = this.register("reports", "/admin/reports", "\u71DF\u6536\u5831\u8868", UserType.ADMIN, "pi-chart-bar", true, "\u884C\u653F\u8CA1\u52D9");
  // Group: 系統設定
  static ADMIN_STAFF = this.register("staff", "/admin/staff", "\u4EBA\u54E1\u7BA1\u7406", UserType.ADMIN, "pi-id-card", true, "\u7CFB\u7D71\u8A2D\u5B9A");
  static ADMIN_CAMPUSES = this.register("campuses", "/admin/campuses", "\u5206\u6821\u8A2D\u5B9A", UserType.ADMIN, "pi-building", true, "\u7CFB\u7D71\u8A2D\u5B9A");
  static ADMIN_SETTINGS = this.register("settings", "/admin/settings", "\u7CFB\u7D71\u8A2D\u5B9A", UserType.ADMIN, "pi-cog", true, "\u7CFB\u7D71\u8A2D\u5B9A");
  static ADMIN_CHANGE_PASSWORD = this.register("change-password", "/admin/change-password", "\u8B8A\u66F4\u5BC6\u78BC", UserType.ADMIN, "pi-key", false);
  // Teacher
  static TEACHER_ROOT = this.register("teacher", "/teacher", "\u8001\u5E2B", UserType.TEACHER, "pi-user", false);
  // Ungrouped
  static TEACHER_DASHBOARD = this.register("dashboard", "/teacher/dashboard", "\u5100\u8868\u677F", UserType.TEACHER, "pi-home");
  static TEACHER_NOTIFICATIONS = this.register("notifications", "/teacher/notifications", "\u901A\u77E5\u4E2D\u5FC3", UserType.TEACHER, "pi-bell");
  static TEACHER_CHANGE_PASSWORD = this.register("change-password", "/teacher/change-password", "\u8B8A\u66F4\u5BC6\u78BC", UserType.TEACHER, "pi-key", false);
  // Group: 教學課務
  static TEACHER_SCHEDULE = this.register("schedule", "/teacher/schedule", "\u8AB2\u8868", UserType.TEACHER, "pi-calendar", true, "\u6559\u5B78\u8AB2\u52D9");
  static TEACHER_ATTENDANCE = this.register("attendance", "/teacher/attendance", "\u9EDE\u540D", UserType.TEACHER, "pi-check-circle", true, "\u6559\u5B78\u8AB2\u52D9");
  static TEACHER_STUDENTS = this.register("students", "/teacher/students", "\u5B78\u751F", UserType.TEACHER, "pi-users", true, "\u6559\u5B78\u8AB2\u52D9");
  // Parent
  static PARENT_ROOT = this.register("parent", "/parent", "\u5BB6\u9577", UserType.PARENT, "pi-user", false);
  // Ungrouped
  static PARENT_DASHBOARD = this.register("dashboard", "/parent/dashboard", "\u5100\u8868\u677F", UserType.PARENT, "pi-home");
  static PARENT_NOTIFICATIONS = this.register("notifications", "/parent/notifications", "\u901A\u77E5\u4E2D\u5FC3", UserType.PARENT, "pi-bell");
  static PARENT_CHANGE_PASSWORD = this.register("change-password", "/parent/change-password", "\u8B8A\u66F4\u5BC6\u78BC", UserType.PARENT, "pi-key", false);
  // Group: 學習狀況
  static PARENT_SCHEDULE = this.register("schedule", "/parent/schedule", "\u8AB2\u8868\u67E5\u770B", UserType.PARENT, "pi-calendar-plus", true, "\u5B78\u7FD2\u72C0\u6CC1");
  static PARENT_ATTENDANCE = this.register("attendance", "/parent/attendance", "\u5230\u73ED\u7D00\u9304", UserType.PARENT, "pi-calendar", true, "\u5B78\u7FD2\u72C0\u6CC1");
  static PARENT_GRADES = this.register("grades", "/parent/grades", "\u6210\u7E3E\u67E5\u95B1", UserType.PARENT, "pi-chart-line", true, "\u5B78\u7FD2\u72C0\u6CC1");
  // Group: 行政服務
  static PARENT_TRIAL = this.register("trial", "/parent/trial", "\u8A66\u807D\u7533\u8ACB", UserType.PARENT, "pi-headphones", true, "\u884C\u653F\u670D\u52D9");
  static PARENT_ENROLLMENT = this.register("enrollment", "/parent/enrollment", "\u5831\u540D\u7533\u8ACB", UserType.PARENT, "pi-user-plus", true, "\u884C\u653F\u670D\u52D9");
  static PARENT_ADD_COURSE = this.register("add-course", "/parent/add-course", "\u52A0\u9078\u8AB2\u7A0B", UserType.PARENT, "pi-plus-circle", true, "\u884C\u653F\u670D\u52D9");
  static PARENT_RENEWAL = this.register("renewal", "/parent/renewal", "\u7E8C\u8AB2\u8CC7\u8A0A", UserType.PARENT, "pi-refresh", true, "\u884C\u653F\u670D\u52D9");
  // Group: 生活與繳費
  static PARENT_MEALS = this.register("meals", "/parent/meals", "\u9910\u8CBB\u7D00\u9304", UserType.PARENT, "pi-dollar", true, "\u751F\u6D3B\u8207\u7E73\u8CBB");
  static PARENT_PAYMENTS = this.register("payments", "/parent/payments", "\u7E73\u8CBB\u7D00\u9304", UserType.PARENT, "pi-wallet", true, "\u751F\u6D3B\u8207\u7E73\u8CBB");
  static register(relativePath, absolutePath, label, role, icon, showInMenu = true, group) {
    const route = new RouteObj(relativePath, absolutePath, label, role, icon, showInMenu, group);
    this.values.push(route);
    return route;
  }
  static findByAbsolutePath(path) {
    return this.values.find((p) => p.absolutePath === path);
  }
};

export {
  RoutesCatalog
};
//# sourceMappingURL=chunk-6PJ7S3AC.js.map
