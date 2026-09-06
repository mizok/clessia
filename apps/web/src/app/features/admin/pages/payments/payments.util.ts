import type { Invoice } from '@core/invoices.service';

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
  if (invoice.status === 'paid') return false;

  return invoice.dueDate < today;
}

/** 還欠多少。溢繳（退費多於應繳）回負數 —— 夾成 0 會讓「該退多少」看不見 */
export function outstanding(invoice: Invoice): number {
  return invoice.total - invoice.netPaid;
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
