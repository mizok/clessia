import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';

import type { FeeTemplate } from '@core/fee-templates.service';
import type { ProrationPreview } from '@core/enrollments.service';

import {
  billingModeOptions,
  feeTemplateOptions,
  findTemplate,
  isAdjusted,
  pricingHint,
  type BillingDraft,
} from '../enrollment-billing.util';

/**
 * 報名的計費欄位 —— 模式／價目表／議定金額／調整原因，加上期中插班的試算。
 *
 * **抽出來的理由是 SCSS 預算，不是重用。** `student-picker-dialog` 的樣式表本來就
 * 貼著 6 kB，計費區塊加上試算之後超了 165 bytes，而下一片還要再加期繳的收費週期選單。
 * 壓的空間上一輪已經用完了 —— 再壓就是犧牲可讀性換一個數字。
 *
 * 附帶效果是 `enrollment-billing-dialog`（單筆編輯）將來也能改用它，
 * 但**那不是現在做這件事的原因**，也還沒做 —— 兩邊的外框差很多，
 * 硬套會變成一個到處都是 `@if` 的殼。
 */
@Component({
  selector: 'app-enrollment-billing-fields',
  standalone: true,
  imports: [FormsModule, ButtonModule, InputNumberModule, SelectModule, TextareaModule],
  templateUrl: './enrollment-billing-fields.component.html',
  styleUrl: './enrollment-billing-fields.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnrollmentBillingFieldsComponent {
  readonly draft = input.required<BillingDraft>();
  readonly templates = input.required<readonly FeeTemplate[]>();
  /** 沒有比例可算（整期都在讀、或不是月繳）時傳 `null` —— 那時候沒有東西要解釋 */
  readonly proration = input<ProrationPreview | null>(null);

  readonly draftChange = output<BillingDraft>();
  readonly prorationApplied = output<void>();

  protected readonly billingModeOptions = billingModeOptions();
  protected readonly templateOptions = computed(() => feeTemplateOptions(this.templates()));

  private readonly selectedTemplate = computed(() =>
    findTemplate(this.templates(), this.draft().feeTemplateId),
  );

  protected readonly pricingHint = computed(() => pricingHint(this.selectedTemplate()));

  /** 有議定金額且跟定價不同 = 一次議價，規則 5.3 要求留原因 */
  protected readonly isAdjusted = computed(() =>
    isAdjusted(this.draft().agreedAmount, this.selectedTemplate()),
  );

  protected update<K extends keyof BillingDraft>(field: K, value: BillingDraft[K]): void {
    this.draftChange.emit({ ...this.draft(), [field]: value });
  }
}
