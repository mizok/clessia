import { describe, expect, it } from 'vitest';

import { effectiveFromSuffix, effectiveRangeLabel, rangesOverlap } from './schedule-effective.util';

describe('schedule-effective.util（#1100 #22）', () => {
  it('目錄：未來時段加「X 起」，已生效不加', () => {
    expect(effectiveFromSuffix('2026-11-01')).toBe('（11/1 起）');
    expect(effectiveFromSuffix(null)).toBe('');
  });

  it('管理端區間：已生效不止／未來／會結束／未來且會結束', () => {
    const today = '2026-10-28';
    expect(effectiveRangeLabel('2026-09-01', null, today)).toBe('');
    expect(effectiveRangeLabel('2026-11-01', null, today)).toBe('11/1 起');
    expect(effectiveRangeLabel('2026-09-01', '2026-10-31', today)).toBe('至 10/31');
    expect(effectiveRangeLabel('2026-11-01', '2026-12-31', today)).toBe('11/1–12/31');
  });

  it('區間交集：相鄰不算重疊；null＝不限', () => {
    const r = (effectiveFrom: string | null, effectiveTo: string | null) => ({
      effectiveFrom,
      effectiveTo,
    });
    expect(rangesOverlap(r('2026-09-01', '2026-10-31'), r('2026-11-01', null))).toBe(false);
    expect(rangesOverlap(r('2026-09-01', '2026-11-01'), r('2026-11-01', null))).toBe(true);
    expect(rangesOverlap(r(null, null), r('2026-11-01', null))).toBe(true);
  });
});
