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
