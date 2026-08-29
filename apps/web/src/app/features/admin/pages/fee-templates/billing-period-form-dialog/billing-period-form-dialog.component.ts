import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { BillingPeriodsService, type BillingPeriod } from '@core/billing-periods.service';

/**
 * 收費期間表單。
 *
 * 驗證**只有一條**：結束日不得早於開始日。**期間之間可以重疊，不要擋** ——
 * 過渡期（舊制最後一期與新制第一期）是真實情境，擋掉只會逼行政去改日期硬湊。
 * 後端的 `isValidPeriodRange` 也刻意只看單筆。
 */
@Component({
  selector: 'app-billing-period-form-dialog',
  standalone: true,
  imports: [FormsModule, ButtonModule, InputTextModule, DatePickerModule],
  templateUrl: './billing-period-form-dialog.component.html',
  styleUrl: './billing-period-form-dialog.component.scss',
})
export class BillingPeriodFormDialogComponent {
  private readonly service = inject(BillingPeriodsService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly period = signal<BillingPeriod | null>(this.config.data?.period ?? null);
  protected readonly isEditing = computed(() => this.period() !== null);
  protected readonly saving = signal(false);

  protected readonly form = signal({
    name: this.period()?.name ?? '',
    startDate: toDate(this.period()?.startDate),
    endDate: toDate(this.period()?.endDate),
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

    if (!name || !form.startDate || !form.endDate) {
      this.messageService.add({
        severity: 'warn',
        summary: '請填完整',
        detail: '名稱、起始日、結束日都是必填',
      });
      return;
    }

    const startDate = toIsoDate(form.startDate);
    const endDate = toIsoDate(form.endDate);

    if (endDate < startDate) {
      this.messageService.add({
        severity: 'warn',
        summary: '日期不合理',
        detail: '結束日不得早於開始日',
      });
      return;
    }

    this.saving.set(true);
    const payload = { name, startDate, endDate };
    const request = this.isEditing()
      ? this.service.update(this.period()!.id, payload)
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

function toDate(value?: string): Date | null {
  return value ? new Date(`${value}T00:00:00`) : null;
}

/** 本地時區的 YYYY-MM-DD —— `toISOString()` 會先轉 UTC，在台灣早上八點前會少一天 */
function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
