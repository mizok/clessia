/**
 * 帳單狀態是**推導**出來的，不是欄位。
 *
 * grilling 總表的原則：「能算的不存」—— 存一個 status 欄位就得在每一次收款、退費、
 * 改明細之後記得更新它，而漏掉一次之後沒有人查得出來哪裡開始不對。推導在來源被
 * 修正時自己就對了。
 *
 * 見 kb/wiki/rules/billing-rules.md 規則 4。
 */

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid';

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

export function deriveInvoiceStatus(items: AmountRow[], payments: PaymentRow[]): InvoiceStatus {
  const { total, net } = invoiceTotals(items, payments);

  // 先判 unpaid：這樣「還沒加明細的空帳單」會是未繳而不是繳清（`net >= total`
  // 在 0 >= 0 時會成立，顯示繳清會騙人 —— 什麼都還沒收）
  if (net <= 0) return 'unpaid';
  if (net >= total) return 'paid';

  return 'partial';
}
