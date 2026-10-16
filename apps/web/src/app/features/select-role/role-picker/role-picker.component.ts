import { Component, ElementRef, afterNextRender, computed, inject } from '@angular/core';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

import { AuthService, type UserRole } from '@core/auth.service';

interface RoleOption {
  role: UserRole;
  /** A6 的 16×16 線條圖示（a6.js icon.shield／book／users）的 path */
  icon: string;
  label: string;
  description: string;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    role: 'admin',
    icon: 'M8 1.8l5 1.9v4c0 3.2-2.1 5.4-5 6.5-2.9-1.1-5-3.3-5-6.5v-4z',
    label: '管理員',
    description: '跨分校管理、系統設定、日常營運',
  },
  { role: 'teacher', icon: 'M8 4.2C6.6 3.2 4.7 2.8 2.5 3v9.5c2.2-.2 4.1.2 5.5 1.2 1.4-1 3.3-1.4 5.5-1.2V3c-2.2-.2-4.1.2-5.5 1.2zM8 4.2v9.5', label: '任課老師', description: '課表、點名、學生學習紀錄' },
  { role: 'parent', icon: 'M8.3 5.5a2.3 2.3 0 11-4.6 0 2.3 2.3 0 014.6 0zM1.8 13.2c.4-2.3 2.1-3.7 4.2-3.7s3.8 1.4 4.2 3.7M10.6 3.4a2.2 2.2 0 010 4.2M12 9.8c1.2.5 2 1.7 2.2 3.4', label: '家長', description: '出缺席、學習進度、繳費' },
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

  constructor() {
    // 彈窗的可及名稱＝「{名}，你好」。PrimeNG 只在有 header 時自己掛 aria-labelledby，
    // 這個彈窗刻意沒有 header（showHeader: false），所以由內容補上（#1636）
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() =>
      host.closest('[role="dialog"]')?.setAttribute('aria-labelledby', 'role-picker-title'),
    );
  }

  selectRole(role: UserRole) {
    this.ref.close(role);
  }
}
