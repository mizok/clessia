/**
 * 帳單狀態是**推導**出來的，不是欄位。
 *
 * grilling 總表的原則：「能算的不存」—— 存一個 status 欄位就得在每一次收款、退費、
 * 改明細之後記得更新它，而漏掉一次之後沒有人查得出來哪裡開始不對。推導在來源被
 * 修正時自己就對了。
 *
 * 見 kb/wiki/rules/billing-rules.md 規則 4。
 */

/**
 * `void` 是例外：它**不是**推導出來的，是 `invoices.voided_at` 這個事實（#898）——
 * 「這張作廢了」是一個人的決定，算不出來。所以它蓋過其餘三態。
 */
export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'void';

export interface AmountRow {
  amount: number;
}

export interface PaymentRow {
  kind: 'payment' | 'refund';
  amount: number;
}

/**
 * `total` = 明細加總（調整列可以是負數）；`net` = 收款 − 退費。
 *
 * 退費在 DB 裡**金額恆正**、正負由 `kind` 決定 —— 負數金額在報表上加總很容易加錯邊，
 * 而 kind 是看得見的。
 */
export function invoiceTotals(
  items: AmountRow[],
  payments: PaymentRow[],
): { total: number; net: number } {
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  const net = payments.reduce(
    (sum, payment) => sum + (payment.kind === 'refund' ? -payment.amount : payment.amount),
    0,
  );

  return { total, net };
}

/**
 * `voided` 刻意是**必填**：可選的話，漏傳的呼叫端會把作廢單推導成未繳，
 * 而那會讓它以全額出現在催繳清單上 —— 編譯錯誤比那便宜。
 */
export function deriveInvoiceStatus(
  items: AmountRow[],
  payments: PaymentRow[],
  voided: boolean,
): InvoiceStatus {
  if (voided) return 'void';

  const { total, net } = invoiceTotals(items, payments);

  // 先判 unpaid：這樣「還沒加明細的空帳單」會是未繳而不是繳清（`net >= total`
  // 在 0 >= 0 時會成立，顯示繳清會騙人 —— 什麼都還沒收）
  if (net <= 0) return 'unpaid';
  if (net >= total) return 'paid';

  return 'partial';
}

/**
 * 「還在等錢」的**唯一定義** —— 催繳、逾期、快到期、家長應繳都問這一句。
 *
 * #898 之前全系統寫成 `status !== 'paid'`；多了 `void` 之後那個寫法會把作廢單
 * 以全額算進去。所以改成列舉「是」的那兩態，而不是排除「不是」的 —— 將來再多
 * 一種狀態時，預設落在「不算欠」那邊。
 */
export function isOpenInvoice(status: InvoiceStatus): boolean {
  return status === 'unpaid' || status === 'partial';
}

export type VoidBlockReason = 'ALREADY_VOIDED' | 'NET_PAID_NONZERO' | 'HAS_SESSION_PACK';

/**
 * 作廢的前置條件（使用者 2026-09-30 裁決，#898）。回 `null` 代表可以作廢。
 *
 * - 淨額 ≠ 0 一律擋，**含負數**（退多了 = 還欠家長錢）
 * - 連到堂數包就擋（作廢帳單但堂數還在 = 沒收錢的堂數）
 *
 * 淨額與「已作廢」在 DB trigger 另有一層（`20260930072356_invoice_void.sql`），
 * 這裡是為了回看得懂的錯誤。**堂數包那條只有這一層。**
 */
export function voidBlockReason(input: {
  voided: boolean;
  netPaid: number;
  hasSessionPack: boolean;
}): VoidBlockReason | null {
  // 已作廢先講 —— 對一張作廢單說「請先退款」是錯的指示
  if (input.voided) return 'ALREADY_VOIDED';
  if (input.netPaid !== 0) return 'NET_PAID_NONZERO';
  if (input.hasSessionPack) return 'HAS_SESSION_PACK';

  return null;
}
