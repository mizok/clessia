import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { AuthService } from '@core/auth.service';
import { environment } from '@env/environment';
import { firstValueFrom } from 'rxjs';

type FieldKey = 'displayName' | 'email' | 'phone' | 'birthday';

@Component({
  selector: 'app-account-settings-dialog',
  standalone: true,
  imports: [
    FormsModule,
    InputTextModule,
    ButtonModule,
    DatePickerModule,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './account-settings-dialog.component.html',
  styleUrl: './account-settings-dialog.component.scss',
})
export class AccountSettingsDialogComponent {
  private readonly http = inject(HttpClient);
  private readonly ref = inject(DynamicDialogRef);
  private readonly auth = inject(AuthService);
  private readonly confirmationService = inject(ConfirmationService);

  protected readonly savingField = signal<FieldKey | null>(null);
  protected readonly savedField = signal<FieldKey | null>(null);
  protected readonly fieldError = signal<{ field: FieldKey; msg: string } | null>(null);
  protected readonly activating = signal(false);
  protected readonly activateError = signal<string | null>(null);
  protected readonly isRootUser = signal(false);

  protected readonly saving = computed(() => this.savingField() !== null);

  protected readonly hasParentRole = computed(() =>
    this.auth.roles().includes('parent'),
  );

  protected displayName = this.auth.profile()?.display_name ?? '';
  protected email = this.auth.user()?.email ?? '';
  protected phone = '';
  protected birthday: Date | null = null;

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
          isRootUser: boolean;
        }>(`${environment.apiUrl}/api/me`, { withCredentials: true }),
      );
      this.displayName = me.displayName;
      this.email = me.email ?? '';
      this.phone = me.phone ?? '';
      this.birthday = me.birthday ? new Date(me.birthday) : null;
      this.isRootUser.set(me.isRootUser);
    } catch {
      // silently ignore — 初始值已從 auth.user() 設定
    }
  }

  protected saveDisplayName() {
    this.patchMe('displayName', { displayName: this.displayName.trim() });
  }

  protected saveBirthday() {
    this.patchMe('birthday', { birthday: this.birthday ? this.formatDate(this.birthday) : null });
  }

  protected confirmSaveEmail() {
    this.confirmationService.confirm({
      key: 'account-settings-confirm',
      message: `確定要將 Email 改為「${this.email}」嗎？\n儲存後需用新 Email 登入。`,
      header: '確認修改 Email',
      acceptLabel: '確定修改',
      rejectLabel: '取消',
      accept: () => this.patchMe('email', { email: this.email.trim() }),
    });
  }

  protected confirmSavePhone() {
    this.confirmationService.confirm({
      key: 'account-settings-confirm',
      message: `確定要將電話改為「${this.phone}」嗎？\n儲存後需用新電話登入。`,
      header: '確認修改電話',
      acceptLabel: '確定修改',
      rejectLabel: '取消',
      accept: () => this.patchMe('phone', { phone: this.phone.trim() || null }),
    });
  }

  private patchMe(field: FieldKey, payload: Record<string, unknown>) {
    this.savingField.set(field);
    this.fieldError.set(null);
    this.http
      .patch(`${environment.apiUrl}/api/me`, payload, { withCredentials: true })
      .subscribe({
        next: () => {
          this.savingField.set(null);
          this.savedField.set(field);
          void this.auth.refreshRoles();
          setTimeout(() => {
            if (this.savedField() === field) this.savedField.set(null);
          }, 2000);
        },
        error: (err) => {
          this.savingField.set(null);
          const code = (err.error as { code?: string } | null)?.code;
          const msg = code === 'EMAIL_ALREADY_IN_USE' ? '此 Email 已被使用' : '更新失敗，請稍後再試';
          this.fieldError.set({ field, msg });
          setTimeout(() => {
            if (this.fieldError()?.field === field) this.fieldError.set(null);
          }, 4000);
        },
      });
  }

  protected confirmActivateParent() {
    this.confirmationService.confirm({
      key: 'account-settings-confirm',
      message: '啟用後即可使用家長 portal 查看子女的出缺席與課表，之後可在家長頁面中新增子女。',
      header: '確認啟用家長身份',
      acceptLabel: '確認啟用',
      rejectLabel: '取消',
      accept: () => this.activateParent(),
    });
  }

  private activateParent() {
    this.activating.set(true);
    this.activateError.set(null);
    this.http
      .post(`${environment.apiUrl}/api/me/activate-parent`, {}, { withCredentials: true })
      .subscribe({
        next: () => {
          void this.auth.refreshRoles();
          this.activating.set(false);
        },
        error: () => {
          this.activateError.set('啟用失敗，請稍後再試');
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
