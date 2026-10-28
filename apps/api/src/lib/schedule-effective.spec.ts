import { describe, expect, it } from 'vitest';

import {
  isScheduleCurrentOrUpcoming,
  isScheduleEffectiveOn,
  scheduleOverlaps,
} from './schedule-effective';

/**
 * #1100 #22 的設計邊界：舊時段止於 X−1、新時段起於 X —— **兩端都含**。
 * 止日或起日當天不算的話，換時段那天的課會整堂消失（審核席 #2050 二讀）。
 */
describe('schedule-effective（兩端都含）', () => {
  const r = { effectiveFrom: '2026-03-01', effectiveTo: '2026-03-31' };

  it('isScheduleEffectiveOn：起日、止日當天都有效；前一天、後一天無效', () => {
    expect(isScheduleEffectiveOn(r, '2026-03-01')).toBe(true);
    expect(isScheduleEffectiveOn(r, '2026-03-31')).toBe(true);
    expect(isScheduleEffectiveOn(r, '2026-02-28')).toBe(false);
    expect(isScheduleEffectiveOn(r, '2026-04-01')).toBe(false);
    expect(
      isScheduleEffectiveOn({ effectiveFrom: '2026-03-01', effectiveTo: null }, '2999-01-01'),
    ).toBe(true);
  });

  it('舊段止於 X−1、新段起於 X：每一天剛好一段有效', () => {
    const old = { effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31' };
    const next = { effectiveFrom: '2026-04-01', effectiveTo: null };
    for (const d of ['2026-03-31', '2026-04-01']) {
      expect([old, next].filter((s) => isScheduleEffectiveOn(s, d))).toHaveLength(1);
    }
  });

  it('scheduleOverlaps：只碰到止日或起日那一天也算交集', () => {
    expect(scheduleOverlaps(r, '2026-03-31', '2026-05-01')).toBe(true);
    expect(scheduleOverlaps(r, '2026-01-01', '2026-03-01')).toBe(true);
    expect(scheduleOverlaps(r, '2026-04-01', null)).toBe(false);
    expect(scheduleOverlaps(r, null, '2026-02-28')).toBe(false);
  });

  it('isScheduleCurrentOrUpcoming：止日當天仍算目前', () => {
    expect(isScheduleCurrentOrUpcoming(r, '2026-03-31')).toBe(true);
    expect(isScheduleCurrentOrUpcoming(r, '2026-04-01')).toBe(false);
  });
});
