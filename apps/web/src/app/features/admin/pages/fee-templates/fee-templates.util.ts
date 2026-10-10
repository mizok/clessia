/** 價目表列的用量（#1314 F1，A6 文案）：引用它的報名數；沒有就說「還沒有報名用它」 */
export function inUseLabel(count: number): string {
  return count > 0 ? `${count} 筆報名在用` : '還沒有報名用它';
}

/**
 * 收費期間「報名」欄（#1314 F4）：與這期日期重疊的在讀期繳報名數。
 * **文案不暗示能不能刪** —— 擋刪除的是已開的帳單明細，不是這個數字。
 */
export function periodUsageLabel(count: number): string {
  return count > 0 ? `${count} 筆報名在此期間` : '沒有報名在此期間';
}

/** 價格後面的單位（A6）：月繳「／月」、期繳「／期」，堂數制是整包價不加單位 */
export function amountUnit(mode: 'monthly' | 'period' | 'session_pack'): string {
  return mode === 'monthly' ? '／月' : mode === 'period' ? '／期' : '';
}

/**
 * 跟這段期間日期重疊的其他期間名稱（#1314 F5）。**只是提醒，不擋** ——
 * 新舊制交接時期間本來就會重疊（billing-rules）。日期是 `YYYY-MM-DD`，字串比較即日期比較。
 */
export function overlappingNames(
  period: { id: string; startDate: string; endDate: string },
  all: readonly { id: string; name: string; startDate: string; endDate: string }[],
): string[] {
  return all
    .filter(
      (o) => o.id !== period.id && o.startDate <= period.endDate && period.startDate <= o.endDate,
    )
    .map((o) => o.name);
}
