import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '@env/environment';
import { authClient } from './auth-client';

export type UserRole = 'admin' | 'teacher' | 'parent';

export interface Profile {
  id: string;
  display_name: string;
  branch_id: string | null;
}

interface MeResponse {
  userId: string;
  orgId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  roles: UserRole[];
  permissions: string[];
  isRootUser: boolean;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  private readonly _user = signal<{ id: string; email?: string | null; name?: string } | null>(
    null,
  );
  private readonly _profile = signal<Profile | null>(null);
  private readonly _roles = signal<UserRole[]>([]);
  private readonly _permissions = signal<string[]>([]);
  private readonly _activeRole = signal<UserRole | null>(null);
  private readonly _loading = signal(true);
  private readonly _showRolePicker = signal(false);
  private readonly _isRootUser = signal(false);

  readonly user = this._user.asReadonly();
  readonly profile = this._profile.asReadonly();
  readonly roles = this._roles.asReadonly();
  readonly permissions = this._permissions.asReadonly();
  readonly activeRole = this._activeRole.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly isAuthenticated = computed(() => !!this._user());
  readonly showRolePicker = this._showRolePicker.asReadonly();
  readonly isRootUser = this._isRootUser.asReadonly();

  private readonly shellMap: Record<UserRole, string> = {
    admin: '/admin',
    teacher: '/teacher',
    parent: '/parent',
  };

  constructor() {
    void this.init();
  }

  private async init() {
    try {
      const { data: session } = await authClient.getSession();
      if (session?.user) {
        this._user.set(session.user);
        await this.loadProfile();
      }
    } catch {
      // No session - user not logged in
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * 讀取 `/api/me`。**回傳「有沒有讀到」**，呼叫端要靠它區分兩件不同的事：
   * 讀不到（連線失敗、session 失效）vs 讀到了但這個帳號真的沒有角色。
   *
   * 原本這裡把 `catch` 吞掉、一律把 roles 設成空陣列，於是跨站 cookie 沒送出去
   * 造成的 401 被顯示成「此帳號尚未被指派角色」—— 排查方向一度指向 bootstrap
   * 沒寫 user_roles。訊息說錯地方比沒有訊息更糟。
   */
  private async loadProfile(): Promise<boolean> {
    try {
      const me = await firstValueFrom(
        this.http.get<MeResponse>(`${environment.apiUrl}/api/me`, { withCredentials: true }),
      );

      this._profile.set({
        id: me.userId,
        display_name: me.displayName,
        branch_id: null,
      });
      this._roles.set(me.roles);
      this._permissions.set(me.permissions);
      this._isRootUser.set(me.isRootUser);

      if (me.roles.length === 1) {
        this._activeRole.set(me.roles[0]);
      } else {
        const savedRole = localStorage.getItem('clessia:active-role') as UserRole | null;
        if (savedRole && me.roles.includes(savedRole)) {
          this._activeRole.set(savedRole);
        }
      }

      return true;
    } catch {
      this._profile.set(null);
      this._roles.set([]);
      this._permissions.set([]);
      return false;
    }
  }

  setActiveRole(role: UserRole) {
    this._activeRole.set(role);
    localStorage.setItem('clessia:active-role', role);
  }

  hasPermission(permission: string): boolean {
    return this.permissions().includes(permission) || this.permissions().includes('*');
  }

  openRolePicker() {
    this._showRolePicker.set(true);
  }

  closeRolePicker() {
    this._showRolePicker.set(false);
  }

  /** 回傳有沒有讀到 —— 呼叫端要區分「讀不到」和「沒有角色」時會用到 */
  async refreshRoles(): Promise<boolean> {
    return this.loadProfile();
  }

  /**
   * 把使用者交給 LINE。成功的話瀏覽器會被導走，這個 Promise 不會 resolve 到有意義的東西。
   *
   * 回傳非 null 表示**還沒離開這一頁就失敗了** —— 最常見的原因是 API 沒設定
   * `LINE_CLIENT_ID` / `LINE_CLIENT_SECRET`，那時 provider 根本沒掛上。
   */
  async signInWithLine(): Promise<string | null> {
    const { error } = await authClient.signIn.social({
      provider: 'line',
      callbackURL: `${window.location.origin}/select-role`,
      // 失敗時導回登入頁並帶 ?error= —— 不設的話會落在 Better Auth 的預設頁面，
      // 使用者看到一個不屬於這個系統的畫面
      errorCallbackURL: `${window.location.origin}/login`,
    });

    if (error) {
      return 'LINE 登入失敗，請稍後再試或聯繫補習班';
    }

    return null;
  }

  async signIn(
    account: string,
    password: string,
    _captchaToken?: string,
    loginType: 'email' | 'phone' | 'username' = 'email',
  ): Promise<string | null> {
    const res = await fetch(`${environment.apiUrl}/api/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, password, loginType }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if ((body as { code?: string }).code === 'ACCOUNT_DISABLED') {
        return '帳號已停用，請聯繫管理員';
      }
      return '帳號或密碼錯誤';
    }

    // Session cookie is now set. Sync client state.
    const { data: session } = await authClient.getSession();
    this._user.set(session?.user ?? null);

    // 密碼是對的（上面 /api/login 回 200），但拿不到 profile —— 別謊報成「沒有角色」
    if (!(await this.loadProfile())) {
      return '登入成功，但讀不到帳號資料。請重新整理再試一次；若持續發生請聯繫管理員。';
    }

    return null;
  }

  navigateToRoleShell(role: UserRole) {
    this.setActiveRole(role);
    this.closeRolePicker();
    this.router.navigate([this.shellMap[role]]);
  }

  setRememberMe(_value: boolean): void {
    // Better Auth uses cookies - remember me handled server-side session expiry
  }

  async sendPasswordReset(email: string, _captchaToken?: string): Promise<string | null> {
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });

    return error?.message ?? null;
  }

  async updatePassword(newPassword: string, token?: string): Promise<string | null> {
    if (!token) {
      return '目前僅支援透過重設連結更新密碼';
    }

    const { error } = await authClient.resetPassword({ newPassword, token });
    return error?.message ?? null;
  }

  async signOut() {
    this.closeRolePicker();
    await authClient.signOut({ fetchOptions: { credentials: 'include' } });
    this._user.set(null);
    this._profile.set(null);
    this._roles.set([]);
    this._permissions.set([]);
    this._activeRole.set(null);
    localStorage.removeItem('clessia:active-role');
    this.router.navigate(['/login']);
  }
}
