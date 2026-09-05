import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { format } from 'date-fns';

import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { SessionPacksService } from '@core/session-packs.service';

export interface SessionPackFormDialogData {
  readonly enrollmentId: string;
  readonly studentName: string;
}

/**
 * 記一次堂數購買 —— 照抄 `payment-form-dialog` 的欄位形狀（數量取代金額）。
 *
 * **不做效期、不掛 invoiceItemId**：規則 1 說效期是可選欄位，受訪公司不設；
 * 跟發票項目的關聯是「開帳時反過來標記」的另一條路徑（`uninvoiced-dialog`），
 * 這裡先做「行政手動記一筆買包」這條最小可行的路，兩者之後要接再接。
 */
@Component({
  selector: 'app-session-pack-form-dialog',
  standalone: true,
  imports: [FormsModule, ButtonModule, DatePickerModule, InputNumberModule, InputTextModule],
  templateUrl: './session-pack-form-dialog.component.html',
  styleUrl: './session-pack-form-dialog.component.scss',
})
export class SessionPackFormDialogComponent {
  private readonly service = inject(SessionPacksService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<SessionPackFormDialogData>);

  protected readonly data = this.config.data;
  protected readonly saving = signal(false);

  protected readonly form = signal({
    purchasedCount: 10,
    purchasedAt: new Date(),
    note: '',
  });

  protected update<K extends keyof ReturnType<typeof this.form>>(
    field: K,
    value: ReturnType<typeof this.form>[K],
  ): void {
    this.form.update((f) => ({ ...f, [field]: value }));
  }

  protected save(): void {
    if (this.saving() || !this.data) return;
    const form = this.form();
    const purchasedCount = Math.round(form.purchasedCount ?? 0);

    if (purchasedCount <= 0) {
      this.messageService.add({
        severity: 'warn',
        summary: '堂數必須大於零',
        detail: '請輸入這次實際購買的堂數',
      });
      return;
    }

    this.saving.set(true);
    this.service
      .create({
        enrollmentId: this.data.enrollmentId,
        purchasedCount,
        purchasedAt: format(form.purchasedAt, 'yyyy-MM-dd'),
        note: form.note.trim() || undefined,
      })
      .subscribe({
        next: (res) => {
          this.messageService.add({
            severity: 'success',
            summary: '已記錄購買',
            detail: `${this.data.studentName} 買了 ${purchasedCount} 堂`,
          });
          this.ref.close(res.data);
        },
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '記錄失敗',
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
