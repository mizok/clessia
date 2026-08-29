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
