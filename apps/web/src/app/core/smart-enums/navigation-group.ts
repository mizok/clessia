export class NavigationGroup {
  public static readonly values: NavigationGroup[] = [];

  constructor(
    public readonly key: string,
    public readonly label: string,
  ) {
    NavigationGroup.values.push(this);
  }

  public static readonly ADMIN_ACADEMICS = new NavigationGroup('admin-academics', '課務管理');
  public static readonly ADMIN_STUDENT_AFFAIRS = new NavigationGroup(
    'admin-student-affairs',
    '學務管理',
  );
  public static readonly ADMIN_LEARNING_CENTER = new NavigationGroup(
    'admin-learning-center',
    '考務與成績',
  );
  public static readonly ADMIN_FINANCE = new NavigationGroup('admin-finance', '行政財務');
  public static readonly ADMIN_STAFF = new NavigationGroup('admin-staff', '人事管理');
  public static readonly ADMIN_SETTINGS = new NavigationGroup('admin-settings', '系統設定');

  public static readonly TEACHER_ACADEMICS = new NavigationGroup('teacher-academics', '教學課務');

  public static readonly PARENT_LEARNING = new NavigationGroup('parent-learning', '學習狀況');
  public static readonly PARENT_SERVICES = new NavigationGroup('parent-services', '行政服務');
  public static readonly PARENT_LIFE_AND_PAYMENTS = new NavigationGroup(
    'parent-life-and-payments',
    '生活與繳費',
  );
}
