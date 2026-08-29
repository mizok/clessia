import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import {
  BILLING_MODE_LABELS,
  FeeTemplatesService,
  type BillingMode,
  type FeeTemplate,
} from '@core/fee-templates.service';

/**
 * 價目表表單。**沒有折扣欄位** —— 那是 billing-rules 規則 2 的刻意決定，不是漏掉的。
 * 實際談定的金額寫在每筆報名的 `agreedAmount` 上。
 */
@Component({
  selector: 'app-fee-template-form-dialog',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    ToggleSwitchModule,
  ],
  templateUrl: './fee-template-form-dialog.component.html',
  styleUrl: './fee-template-form-dialog.component.scss',
})
export class FeeTemplateFormDialogComponent {
  private readonly service = inject(FeeTemplatesService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly template = signal<FeeTemplate | null>(this.config.data?.template ?? null);
  protected readonly isEditing = computed(() => this.template() !== null);
  protected readonly saving = signal(false);

  protected readonly billingModeOptions = (Object.keys(BILLING_MODE_LABELS) as BillingMode[]).map(
    (value) => ({ value, label: BILLING_MODE_LABELS[value] }),
  );

  protected readonly form = signal({
    name: this.template()?.name ?? '',
    billingMode: (this.template()?.billingMode ?? 'monthly') as BillingMode,
    amount: this.template()?.amount ?? 0,
    isActive: this.template()?.isActive ?? true,
  });

  protected update<K extends keyof ReturnType<typeof this.form>>(
    field: K,
    value: ReturnType<typeof this.form>[K],
  ): void {
    this.form.update((f) => ({ ...f, [field]: value }));
  }

  protected save(): void {
    const form = this.form();
    const name = form.name.trim();

    if (!name) {
      this.messageService.add({
        severity: 'warn',
        summary: '請填寫方案名稱',
        detail: '方案名稱為必填欄位',
      });
      return;
    }

    // 台幣沒有小數 —— 後端收的是整數，這裡先取整免得送出 4500.0000001
    const amount = Math.round(form.amount ?? 0);
    if (amount < 0) {
      this.messageService.add({
        severity: 'warn',
        summary: '金額不能是負數',
        detail: '請重新輸入',
      });
      return;
    }

    this.saving.set(true);
    const payload = { name, billingMode: form.billingMode, amount, isActive: form.isActive };
    const request = this.isEditing()
      ? this.service.update(this.template()!.id, payload)
      : this.service.create(payload);

    request.subscribe({
      next: (res) => {
        this.messageService.add({
          severity: 'success',
          summary: this.isEditing() ? '更新成功' : '新增成功',
          detail: `「${name}」已儲存`,
        });
        this.ref.close(res.data);
      },
      error: (err) => {
        this.messageService.add({
          severity: 'error',
          summary: this.isEditing() ? '更新失敗' : '新增失敗',
          detail: err.error?.error || '請稍後再試',
        });
        this.saving.set(false);
      },
    });
  }

  protected cancel(): void {
    this.ref.close();
  }
}
