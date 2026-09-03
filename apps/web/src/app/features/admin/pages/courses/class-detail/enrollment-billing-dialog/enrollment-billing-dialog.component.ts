import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { EnrollmentsService, type Enrollment } from '@core/enrollments.service';
import {
  BILLING_MODE_LABELS,
  FeeTemplatesService,
  type BillingMode,
  type FeeTemplate,
} from '@core/fee-templates.service';

import {
  billingModeOptions,
  feeTemplateOptions,
  findTemplate,
  isAdjusted,
  pricingHint,
} from '../enrollment-billing.util';

/**
 * 單筆報名的計費設定 —— 見 kb/wiki/rules/billing-rules.md 規則 1 與 2。
 *
 * **計費模式是報名層級的選擇，不是班級屬性** —— 同一班可以同時有月繳生與期繳生，
 * 所以這個 dialog 掛在班級名單的單筆動作上，不是班級設定裡。
 *
 * **金額：定價 + 人工覆寫，沒有折扣引擎。** 議定金額留空 = 照價目表定價；
 * 填了數字 = 這個學生就是這個價。改動定價要留原因（自由文字），因為現實中
 * 「折數看老闆當下心情，每個客人還有可能不一樣」—— 那是議價不是規則。
 */
@Component({
  selector: 'app-enrollment-billing-dialog',
  standalone: true,
  imports: [FormsModule, ButtonModule, InputNumberModule, SelectModule, TextareaModule],
  templateUrl: './enrollment-billing-dialog.component.html',
  styleUrl: './enrollment-billing-dialog.component.scss',
})
export class EnrollmentBillingDialogComponent {
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly feeTemplatesService = inject(FeeTemplatesService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly enrollment: Enrollment = this.config.data.enrollment;
  protected readonly saving = signal(false);
  protected readonly templates = signal<FeeTemplate[]>([]);

  protected readonly form = signal({
    billingMode: this.enrollment.billingMode as BillingMode | null,
    feeTemplateId: this.enrollment.feeTemplateId,
    agreedAmount: this.enrollment.agreedAmount,
    adjustmentNote: this.enrollment.adjustmentNote ?? '',
  });

  // 這五個判斷跟 student-picker 的計費區塊共用同一份 —— 兩邊的畫面不一樣，
  // 但「什麼算調整」「該收多少」必須是同一個答案（見 enrollment-billing.util）
  protected readonly billingModeOptions = billingModeOptions();

  protected readonly templateOptions = computed(() => feeTemplateOptions(this.templates()));

  private readonly selectedTemplate = computed(() =>
    findTemplate(this.templates(), this.form().feeTemplateId),
  );

  protected readonly pricingHint = computed(() => pricingHint(this.selectedTemplate()));

  protected readonly isAdjusted = computed(() =>
    isAdjusted(this.form().agreedAmount, this.selectedTemplate()),
  );

  constructor() {
    this.feeTemplatesService.list({ isActive: true }).subscribe({
      next: (res) => this.templates.set(res.data),
      error: () => this.templates.set([]),
    });
  }

  protected update<K extends keyof ReturnType<typeof this.form>>(
    field: K,
    value: ReturnType<typeof this.form>[K],
  ): void {
    this.form.update((f) => ({ ...f, [field]: value }));
  }

  protected save(): void {
    const form = this.form();
    const note = (form.adjustmentNote ?? '').trim();

    if (this.isAdjusted() && !note) {
      this.messageService.add({
        severity: 'warn',
        summary: '請填寫調整原因',
        detail: '金額與定價不同時要留下原因 —— 半年後沒有人記得為什麼收這個數字',
      });
      return;
    }

    this.saving.set(true);
    this.enrollmentsService
      .update(this.enrollment.id, {
        billingMode: form.billingMode,
        feeTemplateId: form.feeTemplateId,
        // 留空是「照定價」，不是「免費」—— 送 0 會變成後者
        agreedAmount: form.agreedAmount ?? null,
        adjustmentNote: note || null,
      })
      .subscribe({
        next: (res) => {
          this.messageService.add({
            severity: 'success',
            summary: '已儲存',
            detail: `${this.enrollment.studentName ?? '這位學生'}的計費設定已更新`,
          });
          this.ref.close(res.data);
        },
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '儲存失敗',
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
