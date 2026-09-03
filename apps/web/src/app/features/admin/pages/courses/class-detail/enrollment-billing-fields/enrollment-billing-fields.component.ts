import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';

import type { BillingPeriod } from '@core/billing-periods.service';
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
  /** 沒有比例可算（整期都在讀）時傳 `null` —— 那時候沒有東西要解釋 */
  readonly proration = input<ProrationPreview | null>(null);

  /**
   * 收費期間，**期繳專用**。月繳的期間是月份（後端自己用 `periodMonth` 算），
   * 堂數制按堂不按天沒有期間可言 —— 所以這個選單只在期繳時出現。
   *
   * 它**不存在報名上**（`POST /enrollments` 沒有這個欄位），只用來問後端
   * 「這一段期間、從今天算起，該收多少」。所以它不是 `BillingDraft` 的一部分。
   */
  readonly periods = input<readonly BillingPeriod[]>([]);
  readonly selectedPeriodId = input<string | null>(null);
  readonly selectedPeriodIdChange = output<string | null>();

  readonly draftChange = output<BillingDraft>();
  readonly prorationApplied = output<void>();

  protected readonly billingModeOptions = billingModeOptions();
  protected readonly templateOptions = computed(() => feeTemplateOptions(this.templates()));

  protected readonly isPeriodMode = computed(() => this.draft().billingMode === 'period');

  /** 期間帶上日期 —— 「2026 上學期」這個名字看不出它涵蓋哪幾個月 */
  protected readonly periodOptions = computed(() => [
    { label: '未選擇', value: null as string | null },
    ...this.periods().map((p) => ({
      label: `${p.name}（${p.startDate} ~ ${p.endDate}）`,
      value: p.id as string | null,
    })),
  ]);

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
