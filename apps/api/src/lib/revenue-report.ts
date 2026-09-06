/**
 * 營收報表的聚合。
 *
 * 數字的定義釘死在 `kb/wiki/specs/admin/finance/reports.md`：
 *
 * | 數字 | 定義 |
 * | --- | --- |
 * | 實收 | 區間內 `payment_records` 的正向金額總和 |
 * | 退款 | 區間內的 `refund` 總和，**單獨列不要淨額混算** |
 * | 應收未收 | 區間內開出的帳單應繳總額 − 已收；其中**逾期**的另外標出 |
 *
 * 退款不淨額的理由：「這個月收了 10 萬、退了 3 萬」與「這個月收了 7 萬」是兩個不同的
 * 經營訊號，壓成一個數字就看不出退費在發生。
 *
 * **這支存在的理由是 spec 的 🔴 實作陷阱**：列表 API 的 `pageSize` 上限是 100，
 * 抓一頁明細自己加總會在量大的月份**悄悄少算，而且錯得沒有任何徵兆** ——
 * 報表看起來完全正常，只是數字是錯的。所以每個摘要數字都從這裡出來。
 */

import { isOverdueOn } from './invoice-overdue';

export interface RevenuePayment {
  kind: 'payment' | 'refund';
  amount: number;
  /** 分組鍵（分校名／課程名／月份）。不分組時全部給同一個值 */
  groupKey: string;
}

export interface RevenueInvoice {
  /** 這張帳單的應繳總額（明細加總） */
  billed: number;
  /** 這張帳單**至今**收到的淨額（收款 − 退款）—— 不限區間內 */
  paid: number;
  dueDate: string | null;
  groupKey: string;
}

export interface RevenueFigures {
  received: number;
  refunded: number;
  billed: number;
  outstanding: number;
  overdueOutstanding: number;
}

export interface RevenueGroup extends RevenueFigures {
  key: string;
}

const zero = (): RevenueFigures => ({
  received: 0,
  refunded: 0,
  billed: 0,
  outstanding: 0,
  overdueOutstanding: 0,
});

export function aggregateRevenue(input: {
  payments: RevenuePayment[];
  invoices: RevenueInvoice[];
  /** 判斷逾期的基準日 */
  today: string;
}): { summary: RevenueFigures; groups: RevenueGroup[] } {
  const summary = zero();
  const byGroup = new Map<string, RevenueFigures>();

  const bucket = (key: string): RevenueFigures => {
    const existing = byGroup.get(key);
    if (existing) return existing;
    const created = zero();
    byGroup.set(key, created);
    return created;
  };

  for (const payment of input.payments) {
    const target = payment.kind === 'refund' ? 'refunded' : 'received';
    summary[target] += payment.amount;
    bucket(payment.groupKey)[target] += payment.amount;
  }

  for (const invoice of input.invoices) {
    // **溢繳不產生負的未收。** 不夾的話一張多收的帳單會去抵銷另一張真正的欠款，
    // 而「還有多少沒收到」就會少報 —— 又是一個沒有徵兆的錯
    const unpaid = Math.max(0, invoice.billed - invoice.paid);
    // 「欠」的定義是**過了 due_date 未繳清**（billing-rules 規則 7）。日期那一半的
    // 判斷在 lib/invoice-overdue.ts —— 繳費頁列表（routes/invoices.ts）下在 SQL 上的
    // 是同一支，兩邊不會再各自漂移
    const overdue = isOverdueOn(invoice.dueDate, input.today) ? unpaid : 0;

    const group = bucket(invoice.groupKey);
    summary.billed += invoice.billed;
    summary.outstanding += unpaid;
    summary.overdueOutstanding += overdue;
    group.billed += invoice.billed;
    group.outstanding += unpaid;
    group.overdueOutstanding += overdue;
  }

  const groups = Array.from(byGroup.entries())
    .map(([key, figures]) => ({ key, ...figures }))
    // 順序穩定，不然每次重整報表的列都在跳
    .sort((a, b) => a.key.localeCompare(b.key, 'zh-Hant'));

  return { summary, groups };
}
