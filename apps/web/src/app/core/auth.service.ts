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
  roles: UserRole[];
  permissions: string[];
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  private readonly _user = signal<{ id: string; email?: string | null; name?: string } | null>(null);
  private readonly _profile = signal<Profile | null>(null);
  private readonly _roles = signal<UserRole[]>([]);
  private readonly _permissions = signal<string[]>([]);
  private readonly _activeRole = signal<UserRole | null>(null);
  private readonly _loading = signal(true);
  private readonly _showRolePicker = signal(false);

  readonly user = this._user.asReadonly();
  readonly profile = this._profile.asReadonly();
  readonly roles = this._roles.asReadonly();
  readonly permissions = this._permissions.asReadonly();
  readonly activeRole = this._activeRole.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly isAuthenticated = computed(() => !!this._user());
  readonly showRolePicker = this._showRolePicker.asReadonly();

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

  private async loadProfile() {
    try {
      const me = await firstValueFrom(
        this.http.get<MeResponse>(`${environment.apiUrl}/api/me`, { withCredentials: true })
      );

      this._profile.set({
        id: me.userId,
        display_name: me.displayName,
        branch_id: null,
      });
      this._roles.set(me.roles);
      this._permissions.set(me.permissions);

      if (me.roles.length === 1) {
        this._activeRole.set(me.roles[0]);
      } else {
        const savedRole = localStorage.getItem('clessia:active-role') as UserRole | null;
        if (savedRole && me.roles.includes(savedRole)) {
          this._activeRole.set(savedRole);
        }
      }
    } catch {
      this._profile.set(null);
      this._roles.set([]);
      this._permissions.set([]);
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

  async signIn(emailOrPhone: string, password: string, _captchaToken?: string): Promise<string | null> {
    const { data, error } = await authClient.signIn.email({
      email: emailOrPhone,
      password,
      fetchOptions: { credentials: 'include' },
    });
    if (error || !data?.user) return '帳號或密碼錯誤';

    if (data.user) {
      this._user.set(data.user);
      await this.loadProfile();
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
