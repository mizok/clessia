/**
 * 上課時段的生效區間（#1100 #22）：`schedules.effective_from`（含）～ `effective_to`（含，null＝持續）。
 *
 * 同一個時段（班＋星期＋開始時間）可以前後接續，所以**直接讀 `schedules` 的地方都要先決定看哪一天或哪一段期間**，
 * 不然「下個月起改週三」之後，舊段與新段會被當成兩個同時存在的時段。規則只放這一份。
 */

export interface ScheduleRange {
  effectiveFrom: string;
  /** null = 持續有效 */
  effectiveTo: string | null;
}

/** DB 列（snake_case）→ 區間 */
export function scheduleRangeOf(row: Record<string, unknown>): ScheduleRange {
  return {
    effectiveFrom: row['effective_from'] as string,
    effectiveTo: (row['effective_to'] as string | null) ?? null,
  };
}

/** 這個時段在 `date` 那天有沒有效（兩端都含） */
export function isScheduleEffectiveOn(range: ScheduleRange, date: string): boolean {
  return range.effectiveFrom <= date && (range.effectiveTo === null || range.effectiveTo >= date);
}

/**
 * 這個時段跟 `[from, to]` 這段期間有沒有交集（兩端都含）。
 * `from` 是 null＝不限起點、`to` 是 null＝不限終點。
 */
export function scheduleOverlaps(
  range: ScheduleRange,
  from: string | null,
  to: string | null,
): boolean {
  if (to !== null && range.effectiveFrom > to) return false;
  return from === null || range.effectiveTo === null || range.effectiveTo >= from;
}

/** 今天有效或還沒生效的未來時段（沒有日期脈絡時「現在與之後的課」，#22 Q3） */
export function isScheduleCurrentOrUpcoming(range: ScheduleRange, today: string): boolean {
  return range.effectiveTo === null || range.effectiveTo >= today;
}
