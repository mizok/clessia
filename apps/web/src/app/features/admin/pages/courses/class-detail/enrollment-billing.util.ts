import {
  BILLING_MODE_LABELS,
  type BillingMode,
  type FeeTemplate,
} from '@core/fee-templates.service';

/**
 * 報名的計費設定 —— 見 kb/wiki/rules/billing-rules.md 規則 1 與 2、
 * enrollment-rules 規則 5。
 *
 * 這些判斷有兩個呼叫端：**建立報名時**（student-picker 的確認步驟）與
 * **事後修改時**（enrollment-billing-dialog）。兩邊的畫面不一樣（一個是整批設定、
 * 一個是單筆編輯），但「什麼算調整」「該收多少」必須是同一個答案 ——
 * 兩份各寫一次的話，會出現同一筆報名在兩個畫面上一個要原因、一個不要。
 */
export interface BillingDraft {
  billingMode: BillingMode | null;
  feeTemplateId: string | null;
  agreedAmount: number | null;
  adjustmentNote: string;
}

export function emptyBillingDraft(): BillingDraft {
  return { billingMode: null, feeTemplateId: null, agreedAmount: null, adjustmentNote: '' };
}

export function billingModeOptions(): Array<{ label: string; value: BillingMode | null }> {
  return [
    { label: '未設定', value: null },
    ...(Object.keys(BILLING_MODE_LABELS) as BillingMode[]).map((value) => ({
      label: BILLING_MODE_LABELS[value],
      value: value as BillingMode | null,
    })),
  ];
}

/** 停用的價目表不該還能被挑到（但已經挑過的歷史報名照樣看得懂它） */
export function feeTemplateOptions(
  templates: readonly FeeTemplate[],
): Array<{ label: string; value: string | null }> {
  return [
    { label: '未指定', value: null },
    ...templates.map((t) => ({
      label: `${t.name}（${BILLING_MODE_LABELS[t.billingMode]} $${t.amount.toLocaleString()}）`,
      value: t.id as string | null,
    })),
  ];
}

export function findTemplate(
  templates: readonly FeeTemplate[],
  id: string | null | undefined,
): FeeTemplate | undefined {
  return id ? templates.find((t) => t.id === id) : undefined;
}

/** 定價當參考值顯示 —— 行政要知道自己議的價偏離定價多少 */
export function pricingHint(template: FeeTemplate | undefined): string | null {
  return template ? `定價 $${template.amount.toLocaleString()}` : null;
}

/**
 * 有議定金額，而且它跟定價不同 —— 那就是一次議價，規則 5.3 要求留原因。
 *
 * **沒有選價目表也算調整**：一個憑空填出來的數字更需要說明它從哪來。
 */
export function isAdjusted(
  agreedAmount: number | null | undefined,
  template: FeeTemplate | undefined,
): boolean {
  if (agreedAmount === null || agreedAmount === undefined) return false;
  return !template || agreedAmount !== template.amount;
}

/**
 * 這筆報名該收多少 —— enrollment-rules 規則 5.1 的優先序。
 *
 * 議定金額優先（含 **0**：全免是一個決定，不是沒填）；否則照價目表定價；
 * 兩個都沒有就回 `null` —— **不猜**，讓開帳的人自己填。
 */
export function payableAmount(
  draft: Pick<BillingDraft, 'agreedAmount' | 'feeTemplateId'>,
  templates: readonly FeeTemplate[],
): number | null {
  if (draft.agreedAmount !== null && draft.agreedAmount !== undefined) return draft.agreedAmount;
  return findTemplate(templates, draft.feeTemplateId)?.amount ?? null;
}
