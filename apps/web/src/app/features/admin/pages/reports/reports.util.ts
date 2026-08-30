import type { RevenueGroupBy } from '@core/reports.service';

/**
 * 報表的顯示輔助。
 *
 * **這裡沒有任何加總** —— spec 的 🔴 實作陷阱：前端加總分頁明細會在量大的月份
 * 悄悄少算而且錯得沒有徵兆。所有數字都來自 `/api/reports/revenue`。
 */

/**
 * 後端**明著標出來的模糊桶**（`apps/api/src/routes/reports.ts` 的常數）。
 *
 * 一張帳單可以跨班（同一個學生修兩科）也可以完全沒有班（純餐費帳單）。後端刻意
 * 不做比例拆分（拆出來的數字沒有人能跟收據對得起來）也不重複計入多個組
 * （那會讓小計加起來大於總計）—— 代價是多一列，換來**小計永遠加得回總計**。
 *
 * 字串是跟後端的契約，集中在這裡才改得動。
 */
export const AMBIGUOUS_GROUP_KEYS = ['（跨分校）', '（跨課程）', '（未分類）'] as const;

const AMBIGUOUS = new Set<string>(AMBIGUOUS_GROUP_KEYS);

/** 用來給那幾列一個註記 —— 它們是刻意的模糊，要看得見而不是被藏起來 */
export function isAmbiguousKey(key: string): boolean {
  return AMBIGUOUS.has(key);
}

const MONTH_KEY = /^(\d{4})-(\d{2})$/;

/**
 * 月份分組的鍵是 `YYYY-MM`，補成人看的樣子。
 *
 * 對不上格式就**原樣顯示** —— 後端若回了非預期的字串（例如模糊桶），
 * 原樣顯示比顯示 NaN 或爆掉好。
 */
export function groupKeyLabel(key: string, groupBy: RevenueGroupBy): string {
  if (groupBy !== 'month') return key;

  const match = MONTH_KEY.exec(key);
  if (!match) return key;

  return `${match[1]} 年 ${Number(match[2])} 月`;
}

/** 預設區間：這個月一號到今天 */
export function defaultRange(today: string): { from: string; to: string } {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/**
 * 開帳這筆錢的組成，用來畫橘帶上那條流向。
 *
 * **只用 `billed` 與 `outstanding` 這一組**，不把 `received` 拉進來 ——
 * 收款看收款日、帳單看開帳日（見 `RevenueFigures` 的欄位說明），**兩者是不同
 * 的集合**。拿 `received / billed` 當「收款率」是在比不同的母體，數字看起來
 * 合理但沒有意義。
 *
 * 成立的部分／全體只有這一組：
 *
 *   billed = 已收回（billed − outstanding） + outstanding
 *   overdueOutstanding ⊆ outstanding
 *
 * 這是**顯示用的比例**，不是加總 —— 三個值都由後端給，這裡只是換算成長度。
 */
export interface BilledSplit {
  /** 已收回佔 billed 的百分比 */
  readonly collectedPct: number;
  /** 其中逾期佔 billed 的百分比（畫在未收段的起點） */
  readonly overduePct: number;
  /** 已收回的金額 */
  readonly collected: number;
}

export function splitBilled(figures: {
  billed: number;
  outstanding: number;
  overdueOutstanding: number;
}): BilledSplit {
  const { billed, outstanding, overdueOutstanding } = figures;
  if (billed <= 0) return { collectedPct: 0, overduePct: 0, collected: 0 };

  // 溢繳會讓 outstanding 變負數，夾住才不會畫出超過 100% 的條
  const owed = Math.min(Math.max(outstanding, 0), billed);
  const collected = billed - owed;
  const overdue = Math.min(Math.max(overdueOutstanding, 0), owed);

  return {
    collectedPct: (collected / billed) * 100,
    overduePct: (overdue / billed) * 100,
    collected,
  };
}
