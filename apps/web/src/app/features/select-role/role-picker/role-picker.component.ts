import { Component, computed, inject } from '@angular/core';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

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
 * 角色彈窗的內容。**只負責挑，不負責去哪** —— 選完把角色 `close()` 回給開窗的薄殼，
 * 導向邏輯留在 `AuthService.navigateToRoleShell` 一份。
 *
 * 這支元件連同整棵 PrimeNG dialog 依賴樹都是被動態 import 進來的，
 * 不在初始 bundle 裡（見 `kb/wiki/architecture/login-experience.md`）。
 *
 * 沒有關閉按鈕是刻意的：沒選角色就沒有下一步。
 */
@Component({
  selector: 'app-role-picker',
  imports: [],
  templateUrl: './role-picker.component.html',
  styleUrl: './role-picker.component.scss',
})
export class RolePickerComponent {
  private readonly auth = inject(AuthService);
  private readonly ref = inject(DynamicDialogRef);

  protected readonly displayName = computed(
    () => this.auth.profile()?.display_name || this.auth.user()?.email || '',
  );
  readonly roleOptions = computed(() =>
    ROLE_OPTIONS.filter((opt) => this.auth.roles().includes(opt.role)),
  );
  protected readonly activeRole = this.auth.activeRole;

  selectRole(role: UserRole) {
    this.ref.close(role);
  }
}
