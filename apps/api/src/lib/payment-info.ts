/**
 * 補習班帳戶資訊（#1073）：分校覆寫 → 機構預設，形狀照 `lib/attendance-mode.ts`。
 * 多行自由文字。**空白字串視同沒設定** —— 管理員把欄位清空，意思是「改回沿用」，
 * 不是「這個分校的帳戶資訊是一段空白」。
 */
export function normalizePaymentInfo(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function pickPaymentInfo(campusInfo: unknown, orgInfo: unknown): string | null {
  return normalizePaymentInfo(campusInfo) ?? normalizePaymentInfo(orgInfo);
}

/** 寫入上限（Zod）。DB 不設 CHECK —— 長度是表單的事，不是資料完整性 */
export const PAYMENT_INFO_MAX = 1000;

export interface PaymentInfoEntry {
  /** 多筆時標是哪幾個分校；只有一筆時 null（家長不需要知道是哪一層的設定） */
  readonly campusName: string | null;
  readonly text: string;
}

/**
 * 家長帳單頁要列的帳戶資訊（#1073）：這個孩子在籍分校的生效值，**以內容去重**。
 * 沒有在籍分校 → 機構預設；全都沒設定 → `[]`（前端退回「請洽行政人員」）。
 * 不做每張帳單各自判分校 —— 帳單沒有分校欄，餐費／調整列也沒有報名（計畫席裁 2）。
 */
export function paymentInfoEntries(
  campuses: ReadonlyArray<{ name: string; paymentInfo: unknown }>,
  orgInfo: unknown,
): PaymentInfoEntry[] {
  const resolved =
    campuses.length === 0
      ? [{ name: null, text: normalizePaymentInfo(orgInfo) }]
      : campuses.map((c) => ({ name: c.name, text: pickPaymentInfo(c.paymentInfo, orgInfo) }));

  const byText = new Map<string, string[]>();
  for (const { name, text } of resolved) {
    if (text === null) continue;
    const names = byText.get(text) ?? [];
    if (name !== null) names.push(name);
    byText.set(text, names);
  }

  const entries = [...byText];
  return entries.map(([text, names]) => ({
    campusName: entries.length > 1 && names.length > 0 ? names.join('、') : null,
    text,
  }));
}
