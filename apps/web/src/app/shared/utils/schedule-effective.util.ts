/**
 * 上課時段的生效區間怎麼寫成字（#1100 #22）。API 回 `YYYY-MM-DD`；畫面寫 `11/1`。
 * 同一個時段可以前後接續（「下個月起改週三」），所以未來的段要標「X 起」、會結束的段要標「至 Y」。
 */

/** `2026-11-01` → `11/1` */
export const shortDate = (date: string): string =>
  `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 目錄時段：還沒生效的加「（11/1 起）」，已生效（null）不加 */
export const effectiveFromSuffix = (effectiveFrom: string | null | undefined): string =>
  effectiveFrom ? `（${shortDate(effectiveFrom)} 起）` : '';

/**
 * 管理端時段的區間：已生效且不止＝''；未來＝`11/1 起`；會結束＝`至 10/31`；兩者＝`11/1–12/31`
 */
export function effectiveRangeLabel(
  effectiveFrom: string,
  effectiveTo: string | null,
  today: string,
): string {
  const future = effectiveFrom > today;
  if (future && effectiveTo) return `${shortDate(effectiveFrom)}–${shortDate(effectiveTo)}`;
  if (future) return `${shortDate(effectiveFrom)} 起`;
  if (effectiveTo) return `至 ${shortDate(effectiveTo)}`;
  return '';
}

/** 兩段區間有沒有交集（兩端都含；null＝不限） */
export const rangesOverlap = (
  a: { effectiveFrom: string | null; effectiveTo: string | null },
  b: { effectiveFrom: string | null; effectiveTo: string | null },
): boolean =>
  (a.effectiveTo === null || b.effectiveFrom === null || a.effectiveTo >= b.effectiveFrom) &&
  (b.effectiveTo === null || a.effectiveFrom === null || b.effectiveTo >= a.effectiveFrom);
