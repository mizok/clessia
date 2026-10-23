import type { ParentMealRecord } from '@core/parent-meals.service';

/** 工具列的期間（A6 p-meals：近 3 個月（預設）、近 6 個月、指定月份範圍） */
export type MealPeriod = '3' | '6' | 'custom';

/** API 一次最多 366 天（`routes/parent/meals.ts` 的 MAX_RANGE_DAYS）—— 指定範圍最多 12 個月 */
export const MAX_RANGE_MONTHS = 12;

export interface MealMonth {
  readonly month: string;
  /** 日期新到舊 */
  readonly records: readonly ParentMealRecord[];
  readonly totalAmount: number;
  /** 有收費的餐數（A6「N 餐」只算有收錢的） */
  readonly meals: number;
  /** 整月每一筆都進了帳單 */
  readonly settled: boolean;
}

const toIndex = (month: string) => +month.slice(0, 4) * 12 + +month.slice(5, 7) - 1;
const fromIndex = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;

/** 含本月往回數 n 個月的第一個月（A6 `monthsBack`） */
export function monthsBack(today: string, n: number): string {
  return fromIndex(toIndex(today.slice(0, 7)) - (n - 1));
}

/** 兩個 YYYY-MM 之間含頭尾有幾個月 */
export function monthSpan(from: string, to: string): number {
  return toIndex(to) - toIndex(from) + 1;
}

/** 期間 → 月份區間 [from, to]（YYYY-MM） */
export function periodMonths(
  period: MealPeriod,
  today: string,
  custom: { from: string; to: string },
): [string, string] {
  return period === 'custom'
    ? [custom.from, custom.to]
    : [monthsBack(today, +period), today.slice(0, 7)];
}

/** 月份區間 → API 的日期區間；結束日不超過今天（還沒到的日子不會有紀錄） */
export function monthsToDates(from: string, to: string, today: string): [string, string] {
  const next = fromIndex(toIndex(to) + 1);
  const lastDay = new Date(Date.UTC(+next.slice(0, 4), +next.slice(5, 7) - 1, 0))
    .toISOString()
    .slice(0, 10);
  return [`${from}-01`, lastDay < today ? lastDay : today];
}

/** A6 `mLabel`：今年的只寫月，別年的帶年 */
export function monthLabel(month: string, today: string): string {
  const year = month.slice(0, 4);
  return `${year === today.slice(0, 4) ? '' : `${year} 年 `}${+month.slice(5, 7)} 月`;
}

/** A6 `nextM`：這個月的餐費併進下個月的帳單 —— 9 月的寫「10 月」，12 月的寫「1 月」 */
export function nextMonthLabel(month: string): string {
  return `${(+month.slice(5, 7) % 12) + 1} 月`;
}

/** A6 `md（wd）`：10/21（三） */
export function dayLabel(date: string): string {
  const weekday = '日一二三四五六'[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${+date.slice(5, 7)}/${+date.slice(8, 10)}（${weekday}）`;
}

/** 依月份分組，新到舊；API 本來就按日期新到舊回 */
export function groupByMonth(records: readonly ParentMealRecord[]): MealMonth[] {
  const byMonth = new Map<string, ParentMealRecord[]>();
  for (const record of records) {
    const month = record.date.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), record]);
  }
  return [...byMonth]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([month, rows]) => ({
      month,
      records: [...rows].sort((a, b) => (a.date < b.date ? 1 : -1)),
      totalAmount: rows.reduce((sum, r) => sum + r.amount, 0),
      meals: rows.filter((r) => r.amount > 0).length,
      settled: rows.every((r) => r.settled),
    }));
}

/**
 * 匯出的 CSV（A6 匯出 popup）。稿的欄位是「日期、餐別、金額、備註」，但 API 沒有餐別
 * （meal-rules：每生每日一筆），備註是行政內部用的不回（#1117 裁定）—— 改成「收費」欄。
 * 開頭帶 BOM，Excel 才認得 UTF-8。
 */
export function mealsCsv(records: readonly ParentMealRecord[]): string {
  const rows = [...records]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((r) => [r.date, String(r.amount), r.chargeable ? '收費' : '不收費'].join(','));
  return '﻿' + ['日期,金額,收費', ...rows].join('\r\n');
}
