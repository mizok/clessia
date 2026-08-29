import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { format } from 'date-fns';

import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import {
  InvoicesService,
  PAYMENT_METHOD_LABELS,
  type Invoice,
  type PaymentKind,
  type PaymentMethod,
} from '@core/invoices.service';

import { outstanding } from '../payments.util';

/**
 * 記一筆收款或退費。
 *
 * **收款與退費共用這一個元件**：送的是同一支端點、同一組欄位，差別只有 `kind`
 * 與「退費必須寫原因」。拆成兩個元件會是同一份程式碼複製兩次。
 *
 * 部分收款是常態（billing-rules）—— 金額小於應繳**不需要任何額外確認**，
 * 帳單狀態自己會變成「部分繳」。新生定金就是這條路徑，備註寫「定金」。
 */
@Component({
  selector: 'app-payment-form-dialog',
  standalone: true,
  imports: [
    DecimalPipe,
    FormsModule,
    ButtonModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    SelectModule,
  ],
  templateUrl: './payment-form-dialog.component.html',
  styleUrl: './payment-form-dialog.component.scss',
})
export class PaymentFormDialogComponent {
  private readonly service = inject(InvoicesService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly invoice = signal<Invoice>(this.config.data.invoice);
  protected readonly kind = signal<PaymentKind>(this.config.data.kind ?? 'payment');
  protected readonly isRefund = computed(() => this.kind() === 'refund');
  protected readonly saving = signal(false);

  protected readonly outstandingAmount = computed(() => outstanding(this.invoice()));

  protected readonly methodOptions = (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map(
    (value) => ({ value, label: PAYMENT_METHOD_LABELS[value] }),
  );

  protected readonly form = signal({
    // 退費預設不填金額 —— 退多少是行政判斷，預設一個數字會被順手按下去
    amount:
      this.config.data.kind === 'refund' ? 0 : Math.max(0, outstanding(this.config.data.invoice)),
    method: 'cash' as PaymentMethod,
    paidAt: new Date(),
    note: '',
  });

  protected update<K extends keyof ReturnType<typeof this.form>>(
    field: K,
    value: ReturnType<typeof this.form>[K],
  ): void {
    this.form.update((f) => ({ ...f, [field]: value }));
  }

  protected save(): void {
    const form = this.form();
    // 台幣沒有小數，後端收的是正整數
    const amount = Math.round(form.amount ?? 0);

    if (amount <= 0) {
      this.messageService.add({
        severity: 'warn',
        summary: '金額必須大於零',
        detail: this.isRefund() ? '退費金額填正數即可' : '請輸入這次實際收到的金額',
      });
      return;
    }

    const note = form.note.trim();
    // 退費要留得住為什麼 —— 經手人由後端記，原因只有人寫得出來
    if (this.isRefund() && !note) {
      this.messageService.add({
        severity: 'warn',
        summary: '請填寫退費原因',
        detail: '退費必須說明原因，之後才查得回來',
      });
      return;
    }

    this.saving.set(true);
    this.service
      .recordPayment(this.invoice().id, {
        kind: this.kind(),
        amount,
        method: form.method,
        paidAt: format(form.paidAt, 'yyyy-MM-dd'),
        note: note || undefined,
      })
      .subscribe({
        next: (res) => {
          this.messageService.add({
            severity: 'success',
            summary: this.isRefund() ? '已記錄退費' : '已記錄收款',
            detail: `${this.isRefund() ? '退費' : '收款'} ${amount.toLocaleString('zh-TW')} 元`,
          });
          // 回傳整張帳單 —— 狀態已由後端重新推導，呼叫端直接換掉手上那份
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
