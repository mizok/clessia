import type { ParentMealRecord } from '@core/parent-meals.service';
import {
  dayLabel,
  groupByMonth,
  mealsCsv,
  monthLabel,
  monthSpan,
  monthsBack,
  monthsToDates,
  nextMonthLabel,
  periodMonths,
} from './meals.util';

const rec = (date: string, over: Partial<ParentMealRecord> = {}): ParentMealRecord => ({
  date,
  unitPrice: 80,
  chargeable: true,
  amount: 80,
  settled: false,
  ...over,
});

describe('meals.util', () => {
  it('monthsBack 含本月往回數，跨年', () => {
    expect(monthsBack('2026-10-22', 3)).toBe('2026-08');
    expect(monthsBack('2026-02-01', 3)).toBe('2025-12');
    expect(monthsBack('2026-10-22', 1)).toBe('2026-10');
  });

  it('monthSpan 含頭尾', () => {
    expect(monthSpan('2026-01', '2026-03')).toBe(3);
    expect(monthSpan('2025-11', '2026-10')).toBe(12);
  });

  it('periodMonths：近 N 個月到本月；指定範圍照給的', () => {
    const custom = { from: '2026-01', to: '2026-03' };
    expect(periodMonths('6', '2026-10-22', custom)).toEqual(['2026-05', '2026-10']);
    expect(periodMonths('custom', '2026-10-22', custom)).toEqual(['2026-01', '2026-03']);
  });

  it('monthsToDates：月底（含閏年 2 月），本月截到今天', () => {
    expect(monthsToDates('2026-01', '2026-03', '2026-10-22')).toEqual(['2026-01-01', '2026-03-31']);
    expect(monthsToDates('2028-02', '2028-02', '2028-10-22')).toEqual(['2028-02-01', '2028-02-29']);
    expect(monthsToDates('2026-08', '2026-10', '2026-10-22')).toEqual(['2026-08-01', '2026-10-22']);
  });

  it('monthLabel：今年不帶年', () => {
    expect(monthLabel('2026-04', '2026-10-22')).toBe('4 月');
    expect(monthLabel('2025-12', '2026-10-22')).toBe('2025 年 12 月');
  });

  it('dayLabel：10/21（三）', () => {
    expect(dayLabel('2026-10-21')).toBe('10/21（三）');
    expect(dayLabel('2026-03-01')).toBe('3/1（日）');
  });

  it('groupByMonth：月份新到舊、月內新到舊；餐數只算有收錢的；整月都進帳單才算結算', () => {
    const months = groupByMonth([
      rec('2026-09-02', { settled: true }),
      rec('2026-10-01'),
      rec('2026-09-10', { settled: true, chargeable: false, amount: 0 }),
      rec('2026-10-08', { settled: true }),
    ]);

    expect(months.map((m) => m.month)).toEqual(['2026-10', '2026-09']);
    expect(months[0].records.map((r) => r.date)).toEqual(['2026-10-08', '2026-10-01']);
    expect(months[0].settled).toBe(false);
    expect(months[1]).toMatchObject({ totalAmount: 80, meals: 1, settled: true });
  });

  it('mealsCsv：BOM、表頭、日期舊到新', () => {
    const csv = mealsCsv([rec('2026-10-08'), rec('2026-10-01', { chargeable: false, amount: 0 })]);
    expect(csv).toBe('﻿日期,金額,收費\r\n2026-10-01,0,不收費\r\n2026-10-08,80,收費');
  });
});

describe('nextMonthLabel（#1965，A6 nextM）', () => {
  it('下個月；12 月接 1 月', () => {
    expect(nextMonthLabel('2026-09')).toBe('10 月');
    expect(nextMonthLabel('2026-12')).toBe('1 月');
  });
});
