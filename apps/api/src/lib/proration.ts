/**
 * 插班／退班的比例試算。
 *
 * billing-rules 規則 3：期中插班按當期**剩餘比例**收、退班按剩餘比例退 —— 同一套算法
 * 的正反面。而且**試算是開單時的建議值，不是死規則**：行政可以改（規則 2 的人工覆寫）。
 *
 * 所以這裡回傳的 `note` 跟金額一樣重要：只給一個數字的話沒有人知道它怎麼來的，
 * 也就沒有人敢改它。
 *
 * 基準二選一（天數／堂數）由 `organizations.proration_basis` 決定，**預設天數** ——
 * 按天永遠算得出來，按堂依賴 sessions 已經生成，而學期中段可能還沒排完。
 */

export interface DateRange {
  start: string;
  end: string;
}

export interface ActiveRange {
  from: string;
  /** null = 還在讀，涵蓋到期末 */
  to: string | null;
}

/**
 * 某個月的第一天到最後一天。`'2026-03'` 與 `'2026-03-01'` 都收。
 *
 * 原本是 `routes/billing-runs.ts` 的私有函式。第二個消費者出現時搬過來
 * （報名的比例試算也要吃月份）—— **兩邊各留一份的話，「二月有幾天」這種事
 * 遲早會在其中一份算錯，而且是錢**。
 *
 * 用 UTC 走日曆：日期在這裡是字串上的 `YYYY-MM-DD`，拿本地時區推進會在
 * 夏令時或跨時區部署時差一天。
 */
export function monthRange(periodMonth: string): DateRange {
  const start = `${periodMonth.slice(0, 7)}-01`;
  const startDate = new Date(`${start}T00:00:00Z`);
  // 下個月的第 0 天 = 這個月的最後一天，閏年與大小月都不用自己判斷
  const endDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0));
  return { start, end: endDate.toISOString().slice(0, 10) };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function days(from: string, to: string): number {
  // 含頭含尾 —— 3/1 到 3/31 是 31 天不是 30 天
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

export function prorateByDays(
  fullAmount: number,
  period: DateRange,
  active: ActiveRange,
): { amount: number; note: string | null } {
  const totalDays = days(period.start, period.end);
  const from = active.from > period.start ? active.from : period.start;
  const to = active.to && active.to < period.end ? active.to : period.end;

  if (from > to) {
    // 這一期完全沒讀。呼叫端看到 0 該整筆跳過，不要開一列 0 元的學費
    return { amount: 0, note: null };
  }

  const activeDays = days(from, to);
  if (activeDays >= totalDays) {
    return { amount: fullAmount, note: null };
  }

  return {
    amount: Math.round((fullAmount * activeDays) / totalDays),
    note: `期間 ${totalDays} 天，實際 ${activeDays} 天（${activeDays}/${totalDays}），比例試算，可調整`,
  };
}
