import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { AuthService } from '@core/auth.service';
import { GRADE_LEVELS, GRADE_LEVEL_LABELS } from '@core/students.service';
import { environment } from '@env/environment';
import { firstValueFrom } from 'rxjs';

type AccountView = 'main' | 'activate-step1' | 'activate-step2';

@Component({
  selector: 'app-account-settings-dialog',
  standalone: true,
  imports: [
    FormsModule,
    InputTextModule,
    ButtonModule,
    DatePickerModule,
    SelectModule,
    ConfirmDialogModule,
    ToastModule,
  ],
  providers: [ConfirmationService, MessageService],
  templateUrl: './account-settings-dialog.component.html',
  styleUrl: './account-settings-dialog.component.scss',
})
export class AccountSettingsDialogComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly ref = inject(DynamicDialogRef);
  private readonly auth = inject(AuthService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);

  protected readonly view = signal<AccountView>('main');
  protected readonly saving = signal(false);
  protected readonly activating = signal(false);

  protected readonly hasParentRole = computed(() =>
    this.auth.roles().includes('parent'),
  );

  protected displayName = this.auth.profile()?.display_name ?? '';
  protected email = this.auth.user()?.email ?? '';
  protected phone = '';
  protected birthday: Date | null = null;

  protected studentName = '';
  protected studentGrade = '';

  protected readonly gradeOptions = GRADE_LEVELS.map((g) => ({
    label: GRADE_LEVEL_LABELS[g],
    value: g,
  }));

  constructor() {
    void this.loadMe();
  }

  private async loadMe() {
    try {
      const me = await firstValueFrom(
        this.http.get<{
          displayName: string;
          email: string | null;
          phone: string | null;
          birthday: string | null;
        }>(`${environment.apiUrl}/api/me`, { withCredentials: true }),
      );
      this.displayName = me.displayName;
      this.email = me.email ?? '';
      this.phone = me.phone ?? '';
      this.birthday = me.birthday ? new Date(me.birthday) : null;
    } catch {
      // silently ignore — 初始值已從 auth.user() 設定
    }
  }

  protected saveDisplayName() {
    this.patchMe({ displayName: this.displayName.trim() }, '顯示名稱已更新');
  }

  protected saveBirthday() {
    this.patchMe({ birthday: this.birthday ? this.formatDate(this.birthday) : null }, '生日已更新');
  }

  protected confirmSaveEmail() {
    this.confirmationService.confirm({
      key: 'account-settings-confirm',
      message: `確定要將 Email 改為「${this.email}」嗎？\n儲存後需用新 Email 登入。`,
      header: '確認修改 Email',
      acceptLabel: '確定修改',
      rejectLabel: '取消',
      accept: () => this.patchMe({ email: this.email.trim() }, 'Email 已更新'),
    });
  }

  protected confirmSavePhone() {
    this.confirmationService.confirm({
      key: 'account-settings-confirm',
      message: `確定要將電話改為「${this.phone}」嗎？\n儲存後需用新電話登入。`,
      header: '確認修改電話',
      acceptLabel: '確定修改',
      rejectLabel: '取消',
      accept: () => this.patchMe({ phone: this.phone.trim() || null }, '電話已更新'),
    });
  }

  private patchMe(payload: Record<string, unknown>, successMsg: string) {
    this.saving.set(true);
    this.http
      .patch(`${environment.apiUrl}/api/me`, payload, { withCredentials: true })
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: successMsg });
          this.saving.set(false);
          void this.auth.refreshRoles();
        },
        error: (err) => {
          const code = (err.error as { code?: string } | null)?.code;
          const msg =
            code === 'EMAIL_ALREADY_IN_USE' ? '此 Email 已被使用' : '更新失敗，請稍後再試';
          this.messageService.add({ severity: 'error', summary: msg });
          this.saving.set(false);
        },
      });
  }

  protected goToChangePassword() {
    const role = this.auth.activeRole();
    this.ref.close();
    this.router.navigate([`/${role}/change-password`]);
  }

  protected startActivateParent() {
    this.studentName = '';
    this.studentGrade = '';
    this.view.set('activate-step1');
  }

  protected goToStep2() {
    if (!this.studentName.trim() || !this.studentGrade) return;
    this.view.set('activate-step2');
  }

  protected goBackToStep1() {
    this.view.set('activate-step1');
  }

  protected confirmActivate() {
    this.activating.set(true);
    this.http
      .post(
        `${environment.apiUrl}/api/me/activate-parent`,
        { studentName: this.studentName.trim(), grade: this.studentGrade },
        { withCredentials: true },
      )
      .subscribe({
        next: () => {
          void this.auth.refreshRoles();
          this.messageService.add({
            severity: 'success',
            summary: '家長身份已啟用',
            detail: '下次切換角色時即可使用',
          });
          this.activating.set(false);
          this.view.set('main');
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: '啟用失敗，請稍後再試' });
          this.activating.set(false);
        },
      });
  }

  protected close() {
    this.ref.close();
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
