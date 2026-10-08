import { isOpenInvoice, type Invoice } from '@core/invoices.service';

/**
 * 帳單顯示的邊界計算。狀態本身由後端推導（`@core/invoices.service`），
 * 這裡只處理後端沒回、但畫面需要的三件事。
 *
 * 抽成純函式是因為跨月、null 到期日、退費這些邊界在元件測試裡很難測乾淨
 * （charter 先例：`dashboard.util.ts`、`enrollment-event.util.ts`）。
 */

/**
 * 逾期是**衍生標記不是狀態**（billing-rules **規則 7**「欠繳：可見性，不強制」）：
 * 過了到期日且還沒繳清。（原本引成規則 4，那條是「帳單與收款一對多」。）
 *
 * 日期一律用 `YYYY-MM-DD` 字串比較，不轉 `Date` —— 這兩個值都是純日期，
 * 轉成 Date 會帶進本地時區，跨日的那幾小時會答錯一天。字典序在等長零填的
 * ISO 日期上等同時間序。
 *
 * **但這道防線只擋得住「轉 Date」，擋不住 `today` 本身就算錯**（#467）：
 * 呼叫端拿瀏覽器本地日期進來的話，這裡每一步都對，答案還是錯的。
 * `today` 一律從 `SystemClockService.todayTaipei` 來，不要自己 `new Date()`。
 */
export function isOverdue(invoice: Invoice, today: string): boolean {
  if (invoice.dueDate === null) return false;
  if (!isOpenInvoice(invoice.status)) return false;

  return invoice.dueDate < today;
}

/** 還欠多少。溢繳（收的比應繳多）回負數 —— 夾成 0 會讓「該退多少」看不見 */
export function outstanding(invoice: Invoice): number {
  // 作廢單不欠（#898）—— 淨額歸零才能作廢，但 total 還在，不擋的話會算成欠全額
  if (invoice.status === 'void') return 0;
  // 多退（淨額 < 0，#1034）也不算欠：以前 `total − 負數` 會報成比應繳還大的欠款
  if (invoice.status === 'overrefunded') return 0;
  return invoice.total - invoice.netPaid;
}

/** 多退了多少（淨額 < 0 的那一段）；不是多退的帳單回 0 */
export function overRefunded(invoice: Invoice): number {
  return invoice.status === 'overrefunded' ? -invoice.netPaid : 0;
}

/**
 * 收據號取**最近一次收款**的。`receipt_no` 由 DB trigger 在收款時取號，
 * 退費沒有號碼 —— 拿退費那筆去印會印出一張不存在的收款憑證。
 */
export function receiptNoOf(invoice: Invoice): number | null {
  const receipts = invoice.payments
    .filter((payment) => payment.kind === 'payment' && payment.receiptNo !== null)
    .sort((a, b) => a.paidAt.localeCompare(b.paidAt));

  return receipts.at(-1)?.receiptNo ?? null;
}

/**
 * 逾期第幾天。兩個值都是 `YYYY-MM-DD` 純日期，用 UTC 日數相減 —— 不走本地時區，
 * 跟 `isOverdue` 同一個理由。沒到期日或還沒逾期回 0。
 */
export function daysOverdue(invoice: Invoice, today: string): number {
  if (invoice.dueDate === null || invoice.dueDate >= today) return 0;
  const day = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((day(today) - day(invoice.dueDate)) / 86_400_000);
}

/** 最近一次收款的日期（`M/D`）；沒有收款回 null。退費不算 */
export function lastPaidOn(invoice: Invoice): string | null {
  const last = invoice.payments
    .filter((payment) => payment.kind === 'payment')
    .sort((a, b) => a.paidAt.localeCompare(b.paidAt))
    .at(-1);
  if (!last) return null;
  return `${+last.paidAt.slice(5, 7)}/${+last.paidAt.slice(8, 10)}`;
}
