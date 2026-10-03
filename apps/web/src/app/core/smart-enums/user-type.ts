export type UserRole = 'admin' | 'teacher' | 'parent' | 'kiosk';

export class UserType {
  public static readonly values: UserType[] = [];

  constructor(
    public readonly role: UserRole,
    public readonly label: string,
    public readonly description?: string,
  ) {
    UserType.values.push(this);
  }

  public static findByRole(role: UserRole): UserType | undefined {
    return this.values.find((u) => u.role === role);
  }

  public static readonly ADMIN = new UserType('admin', '管理員');
  public static readonly TEACHER = new UserType('teacher', '老師');
  public static readonly PARENT = new UserType('parent', '家長');
  /** 分校門口的打卡平板（#1127）。不走 ShellLayout、沒有選單 */
  public static readonly KIOSK = new UserType('kiosk', '掃碼機台');
}
