import { UserType } from './user-type';

export class RouteObj {
  constructor(
    public readonly relativePath: string,
    public readonly absolutePath: string,
    public readonly label: string,
    public readonly role: UserType | undefined,
    public readonly icon: string,
    public readonly showInMenu: boolean = true,
    public readonly group?: string,
  ) {}
}

export class RoutesCatalog {
  public static readonly values: RouteObj[] = [];

  // Public
  public static readonly PUBLIC_LOGIN = this.register(
    'login',
    '/login',
    '登入',
    undefined,
    'pi-sign-in',
  );
  public static readonly PUBLIC_TRIAL = this.register(
    'trial',
    '/trial',
    '試聽申請',
    undefined,
    'pi-headphones',
  );
  public static readonly PUBLIC_ENROLLMENT = this.register(
    'enrollment',
    '/enrollment',
    '我要報名',
    undefined,
    'pi-file-edit',
  );
  public static readonly PUBLIC_CHECKIN = this.register(
    'qr-checkin',
    '/qr-checkin',
    'QR 到班打卡',
    undefined,
    'pi-qrcode',
  );
  public static readonly PUBLIC_FORGOT_PASSWORD = this.register(
    'forgot-password',
    '/forgot-password',
    '忘記密碼',
    undefined,
    'pi-key',
    false,
  );
  public static readonly PUBLIC_RESET_PASSWORD = this.register(
    'reset-password',
    '/reset-password',
    '重設密碼',
    undefined,
    'pi-key',
    false,
  );

  // Admin
  public static readonly ADMIN_ROOT = this.register(
    'admin',
    '/admin',
    '管理員',
    UserType.ADMIN,
    'pi-shield',
    false,
  );
  // Ungrouped
  // Ungrouped
  public static readonly ADMIN_DASHBOARD = this.register(
    'dashboard',
    '/admin/dashboard',
    '儀表板',
    UserType.ADMIN,
    'pi-home',
  );
  public static readonly ADMIN_TASKS = this.register(
    'tasks',
    '/admin/tasks',
    '待處理工作',
    UserType.ADMIN,
    'pi-list',
  );
  public static readonly ADMIN_NOTIFICATIONS = this.register(
    'notifications',
    '/admin/notifications',
    '通知中心',
    UserType.ADMIN,
    'pi-bell',
  );
  // Group: 教務管理
  public static readonly ADMIN_COURSES = this.register(
    'courses',
    '/admin/courses',
    '課程管理',
    UserType.ADMIN,
    'pi-users',
    true,
    '教務管理',
  );
  public static readonly ADMIN_CLASS_DETAIL = this.register(
    'courses/:courseId/classes/:classId',
    '/admin/courses/:courseId/classes/:classId',
    '開課班詳情',
    UserType.ADMIN,
    'pi-users',
    false,
    '教務管理',
  );
  public static readonly ADMIN_SESSIONS = this.register(
    'sessions',
    '/admin/sessions',
    '課堂管理',
    UserType.ADMIN,
    'pi-list',
    true,
    '教務管理',
  );
  public static readonly ADMIN_SCHEDULE = this.register(
    'schedule',
    '/admin/schedule',
    '排課管理',
    UserType.ADMIN,
    'pi-table',
    false,
    '教務管理',
  );
  public static readonly ADMIN_CHANGES = this.register(
    'changes',
    '/admin/changes',
    '課務異動',
    UserType.ADMIN,
    'pi-history',
    false,
    '教務管理',
  );

  // Group: 學務管理
  public static readonly ADMIN_STUDENTS = this.register(
    'students',
    '/admin/students',
    '學生管理',
    UserType.ADMIN,
    'pi-users',
    true,
    '學務管理',
  );
  public static readonly ADMIN_STUDENT_DETAIL = this.register(
    'students/:id',
    '/admin/students/:id',
    '學生詳情',
    UserType.ADMIN,
    'pi-user',
    false,
    '學務管理',
  );
  public static readonly ADMIN_PARENTS = this.register(
    'parents',
    '/admin/parents',
    '家長資料',
    UserType.ADMIN,
    'pi-user',
    true,
    '學務管理',
  );
  public static readonly ADMIN_ATTENDANCE = this.register(
    'attendance',
    '/admin/attendance',
    '課堂出勤紀錄',
    UserType.ADMIN,
    'pi-check-circle',
    true,
    '學務管理',
  );
  public static readonly ADMIN_LEAVE = this.register(
    'leave',
    '/admin/leave',
    '學生請假紀錄',
    UserType.ADMIN,
    'pi-file',
    true,
    '學務管理',
  );
  public static readonly ADMIN_GRADES = this.register(
    'grades',
    '/admin/grades',
    '成績查閱',
    UserType.ADMIN,
    'pi-chart-line',
    true,
    '學務管理',
  );

  // Group: 行政財務
  public static readonly ADMIN_FEE_TEMPLATES = this.register(
    'fee-templates',
    '/admin/fee-templates',
    '費用方案管理',
    UserType.ADMIN,
    'pi-wallet',
    true,
    '行政財務',
  );
  public static readonly ADMIN_MEALS = this.register(
    'meals',
    '/admin/meals',
    '餐費管理',
    UserType.ADMIN,
    'pi-dollar',
    true,
    '行政財務',
  );
  public static readonly ADMIN_PAYMENTS = this.register(
    'payments',
    '/admin/payments',
    '繳費紀錄',
    UserType.ADMIN,
    'pi-credit-card',
    true,
    '行政財務',
  );
  public static readonly ADMIN_REPORTS = this.register(
    'reports',
    '/admin/reports',
    '營收報表',
    UserType.ADMIN,
    'pi-chart-bar',
    true,
    '行政財務',
  );

  // Group: 人事管理
  public static readonly ADMIN_STAFF = this.register(
    'staff',
    '/admin/staff',
    '人員管理',
    UserType.ADMIN,
    'pi-id-card',
    true,
    '人事管理',
  );

  // Group: 系統設定
  public static readonly ADMIN_CAMPUSES = this.register(
    'campuses',
    '/admin/campuses',
    '分校設定',
    UserType.ADMIN,
    'pi-building',
    true,
    '系統設定',
  );
  public static readonly ADMIN_SUBJECTS = this.register(
    'subjects',
    '/admin/subjects',
    '科目管理',
    UserType.ADMIN,
    'pi-tag',
    true,
    '系統設定',
  );
  public static readonly ADMIN_SETTINGS = this.register(
    'settings',
    '/admin/settings',
    '系統設定',
    UserType.ADMIN,
    'pi-cog',
    true,
    '系統設定',
  );

  // Teacher
  public static readonly TEACHER_ROOT = this.register(
    'teacher',
    '/teacher',
    '老師',
    UserType.TEACHER,
    'pi-user',
    false,
  );
  // Ungrouped
  public static readonly TEACHER_DASHBOARD = this.register(
    'dashboard',
    '/teacher/dashboard',
    '儀表板',
    UserType.TEACHER,
    'pi-home',
  );
  public static readonly TEACHER_NOTIFICATIONS = this.register(
    'notifications',
    '/teacher/notifications',
    '通知中心',
    UserType.TEACHER,
    'pi-bell',
  );

  // Group: 教學課務
  public static readonly TEACHER_SCHEDULE = this.register(
    'schedule',
    '/teacher/schedule',
    '課表',
    UserType.TEACHER,
    'pi-calendar',
    true,
    '教學課務',
  );
  public static readonly TEACHER_ATTENDANCE = this.register(
    'attendance',
    '/teacher/attendance',
    '點名',
    UserType.TEACHER,
    'pi-check-circle',
    true,
    '教學課務',
  );
  public static readonly TEACHER_STUDENTS = this.register(
    'students',
    '/teacher/students',
    '學生',
    UserType.TEACHER,
    'pi-users',
    true,
    '教學課務',
  );

  // Parent
  public static readonly PARENT_ROOT = this.register(
    'parent',
    '/parent',
    '家長',
    UserType.PARENT,
    'pi-user',
    false,
  );
  // Ungrouped
  public static readonly PARENT_DASHBOARD = this.register(
    'dashboard',
    '/parent/dashboard',
    '儀表板',
    UserType.PARENT,
    'pi-home',
  );
  public static readonly PARENT_NOTIFICATIONS = this.register(
    'notifications',
    '/parent/notifications',
    '通知中心',
    UserType.PARENT,
    'pi-bell',
  );

  // Group: 學習狀況
  public static readonly PARENT_SCHEDULE = this.register(
    'schedule',
    '/parent/schedule',
    '課表查看',
    UserType.PARENT,
    'pi-calendar-plus',
    true,
    '學習狀況',
  );
  public static readonly PARENT_ATTENDANCE = this.register(
    'attendance',
    '/parent/attendance',
    '到班紀錄',
    UserType.PARENT,
    'pi-check-square',
    true,
    '學習狀況',
  );
  public static readonly PARENT_GRADES = this.register(
    'grades',
    '/parent/grades',
    '成績查閱',
    UserType.PARENT,
    'pi-chart-line',
    true,
    '學習狀況',
  );

  // Group: 行政服務
  public static readonly PARENT_TRIAL = this.register(
    'trial',
    '/parent/trial',
    '試聽申請',
    UserType.PARENT,
    'pi-headphones',
    true,
    '行政服務',
  );
  public static readonly PARENT_ENROLLMENT = this.register(
    'enrollment',
    '/parent/enrollment',
    '報名申請',
    UserType.PARENT,
    'pi-user-plus',
    true,
    '行政服務',
  );
  public static readonly PARENT_ADD_COURSE = this.register(
    'add-course',
    '/parent/add-course',
    '加選課程',
    UserType.PARENT,
    'pi-plus-circle',
    true,
    '行政服務',
  );
  public static readonly PARENT_RENEWAL = this.register(
    'renewal',
    '/parent/renewal',
    '續課資訊',
    UserType.PARENT,
    'pi-refresh',
    true,
    '行政服務',
  );

  // Group: 生活與繳費
  public static readonly PARENT_MEALS = this.register(
    'meals',
    '/parent/meals',
    '餐費紀錄',
    UserType.PARENT,
    'pi-dollar',
    true,
    '生活與繳費',
  );
  public static readonly PARENT_PAYMENTS = this.register(
    'payments',
    '/parent/payments',
    '繳費紀錄',
    UserType.PARENT,
    'pi-wallet',
    true,
    '生活與繳費',
  );

  private static register(
    relativePath: string,
    absolutePath: string,
    label: string,
    role: UserType | undefined,
    icon: string,
    showInMenu: boolean = true,
    group?: string,
  ): RouteObj {
    const route = new RouteObj(relativePath, absolutePath, label, role, icon, showInMenu, group);
    this.values.push(route);
    return route;
  }

  public static findByAbsolutePath(path: string): RouteObj | undefined {
    return this.values.find((p) => p.absolutePath === path);
  }
}
