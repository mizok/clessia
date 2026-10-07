/** 價目表「報名」欄（#1314 F1）：引用它的報名數，0 不寫「0 筆」而是 `—` */
export function inUseLabel(count: number): string {
  return count > 0 ? `${count} 筆報名` : '—';
}

/**
 * 收費期間「報名」欄（#1314 F4）：與這期日期重疊的在讀期繳報名數。
 * **文案不暗示能不能刪** —— 擋刪除的是已開的帳單明細，不是這個數字。
 */
export function periodUsageLabel(count: number): string {
  return count > 0 ? `${count} 筆報名在此期間` : '沒有報名在此期間';
}
