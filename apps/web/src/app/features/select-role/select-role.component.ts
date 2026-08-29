import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService, type UserRole } from '@core/auth.service';

interface RoleOption {
  role: UserRole;
  icon: string;
  label: string;
  description: string;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    role: 'admin',
    icon: 'pi-shield',
    label: '管理者',
    description: '跨分校管理、系統設定、日常營運',
  },
  { role: 'teacher', icon: 'pi-book', label: '任課老師', description: '課表、點名、學生學習紀錄' },
  { role: 'parent', icon: 'pi-users', label: '家長', description: '出缺席、學習進度、繳費' },
];

/**
 * `/select-role` 的頁面元件。
 *
 * 原本是掛在 root component 上的 DynamicDialog，代價是整個 PrimeNG dialog 依賴樹
 * （dialog / button / dom / motion / icons，約 140 kB）被釘在初始 bundle 裡，
 * 而多數使用者只有一個角色、永遠看不到這個畫面。改成 lazy route 之後它只在
 * 真的需要選角色時才下載。
 */
@Component({
  selector: 'app-select-role',
  imports: [],
  templateUrl: './select-role.component.html',
  styleUrl: './select-role.component.scss',
})
export class SelectRoleComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly displayName = computed(
    () => this.auth.profile()?.display_name || this.auth.user()?.email || '',
  );
  readonly roleOptions = computed(() =>
    ROLE_OPTIONS.filter((opt) => this.auth.roles().includes(opt.role)),
  );
  readonly activeRole = this.auth.activeRole;

  selectRole(role: UserRole) {
    this.auth.navigateToRoleShell(role);
  }

  /**
   * 還沒選過角色的人是被 guard 趕來這裡的 —— 給他一個「關閉」卻不給去處，
   * 等於把人鎖在一個沒有出口的畫面上，所以那種情況下離開就是登出。
   */
  leave() {
    const role = this.auth.activeRole();
    if (role) {
      void this.router.navigate([`/${role}`]);
      return;
    }

    void this.auth.signOut();
  }
}
