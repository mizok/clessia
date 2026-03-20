import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { authClient } from '@core/auth-client';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';

@Component({
  selector: 'app-change-password-dialog',
  standalone: true,
  imports: [FormsModule, ButtonModule, InputTextModule, InlineNoticeComponent],
  templateUrl: './change-password-dialog.component.html',
  styleUrl: './change-password-dialog.component.scss',
})
export class ChangePasswordDialogComponent {
  private readonly ref = inject(DynamicDialogRef);

  protected currentPassword = '';
  protected newPassword = '';
  protected confirmPassword = '';
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal(false);

  protected async onSubmit() {
    if (!this.currentPassword) {
      this.error.set('請輸入目前密碼');
      return;
    }
    if (this.newPassword.length < 6) {
      this.error.set('新密碼長度至少需要 6 位元組');
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.error.set('兩次輸入的密碼不一致');
      return;
    }

    this.error.set(null);
    this.submitting.set(true);

    try {
      const { error } = await authClient.changePassword({
        newPassword: this.newPassword,
        currentPassword: this.currentPassword,
        revokeOtherSessions: false,
      });
      if (error) {
        this.error.set('修改失敗，請確認目前密碼是否正確');
      } else {
        this.success.set(true);
        setTimeout(() => this.ref.close(), 1500);
      }
    } catch {
      this.error.set('發生未知錯誤，請重試');
    } finally {
      this.submitting.set(false);
    }
  }

  protected close() {
    this.ref.close();
  }
}
