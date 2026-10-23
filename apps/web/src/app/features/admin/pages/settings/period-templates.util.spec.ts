import { describe, expect, it } from 'vitest';

import { nextAcademicYear, periodsFromTemplate } from './period-templates.util';

describe('學期模板（#1100 #35③）', () => {
  it('下一個學年＝今天之後最近的 9/1：10 月按是明年、7 月按是今年、9/1 當天算今年', () => {
    expect(nextAcademicYear('2026-10-23')).toBe(2027);
    expect(nextAcademicYear('2026-07-10')).toBe(2026);
    expect(nextAcademicYear('2026-09-01')).toBe(2026);
    expect(nextAcademicYear('2026-09-02')).toBe(2027);
    expect(nextAcademicYear('2026-01-15')).toBe(2026);
  });

  it('傳統二學期制：民國學年＋上／下學期，下學期在隔年', () => {
    expect(periodsFromTemplate('two-terms', '2026-07-10')).toEqual([
      { name: '115 上學期', startDate: '2026-09-01', endDate: '2027-01-31' },
      { name: '115 下學期', startDate: '2027-02-01', endDate: '2027-06-30' },
    ]);
  });

  it('學期＋寒暑假：四段首尾相接、不重疊', () => {
    const list = periodsFromTemplate('terms-and-breaks', '2026-10-23');
    expect(list.map((p) => p.name)).toEqual(['116 上學期', '116 寒假班', '116 下學期', '116 暑期班']);
    expect(list[0]).toEqual({ name: '116 上學期', startDate: '2027-09-01', endDate: '2028-01-20' });
    expect(list[3]).toEqual({ name: '116 暑期班', startDate: '2028-07-01', endDate: '2028-08-31' });
    for (let i = 1; i < list.length; i++) {
      expect(list[i]!.startDate > list[i - 1]!.endDate).toBe(true);
    }
  });

  it('上學期＋暑假／下學期＋寒假：上學期從那年 7/1 開始', () => {
    expect(periodsFromTemplate('terms-with-breaks', '2026-07-10')).toEqual([
      { name: '115 上學期＋暑假', startDate: '2026-07-01', endDate: '2027-01-31' },
      { name: '115 下學期＋寒假', startDate: '2027-02-01', endDate: '2027-06-30' },
    ]);
  });
});
