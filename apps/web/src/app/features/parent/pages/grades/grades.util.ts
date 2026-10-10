import { addDaysToDateString, taipeiDateString } from '@core/system-clock.service';
import type {
  ParentGradePeriod,
  ParentScoreRecord,
  ParentScoreStatus,
  ParentScoreType,
} from '@core/parent-grades.service';

/**
 * 學期篩選的值：`'all'`、`'unassigned'`（沒有任何期涵蓋），或某個期的 id。
 * 學期＝機構的期（`billing_periods`），使用者裁定全系統只有一條時間軸（#1076）。
 */
export type PeriodFilter = string;

export interface PeriodOption {
  readonly label: string;
  readonly value: PeriodFilter;
}

const inPeriod = (examDate: string, period: ParentGradePeriod): boolean => {
  const day = examDate.slice(0, 10);
  return period.startDate <= day && day <= period.endDate;
};

/** 期允許重疊，所以一筆考試可以同時屬於兩個期 —— 兩邊都看得到，不挑「主要的那個」 */
export function filterByPeriod(
  records: readonly ParentScoreRecord[],
  filter: PeriodFilter,
  periods: readonly ParentGradePeriod[],
): ParentScoreRecord[] {
  if (filter === 'all') return [...records];
  if (filter === 'unassigned') {
    return records.filter((r) => !periods.some((p) => inPeriod(r.examDate, p)));
  }
  const period = periods.find((p) => p.id === filter);
  return period ? records.filter((r) => inPeriod(r.examDate, period)) : [...records];
}

/** 全部＋各期＋未分期（只在真的有未分期的考試時出現 —— 空選項只會讓人點進去看到空白） */
export function periodOptions(
  periods: readonly ParentGradePeriod[],
  records: readonly ParentScoreRecord[],
): PeriodOption[] {
  const options: PeriodOption[] = [
    { label: '全部', value: 'all' },
    ...periods.map((p) => ({ label: p.name, value: p.id })),
  ];
  if (records.some((r) => !periods.some((p) => inPeriod(r.examDate, p)))) {
    options.push({ label: '未分期', value: 'unassigned' });
  }
  return options;
}

/** 預設＝含今天的期；重疊時取起始日最晚的（新的那期）；沒有期涵蓋今天 → 全部 */
export function defaultPeriodFilter(
  periods: readonly ParentGradePeriod[],
  today: string,
): PeriodFilter {
  const current = periods
    .filter((p) => inPeriod(today, p))
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  return current[0]?.id ?? 'all';
}

export const SCORE_STATUS_LABELS: Record<ParentScoreStatus, string> = {
  scored: '已登錄',
  absent: '缺考',
  makeup: '補考',
};

export const SCORE_TYPE_LABELS: Record<ParentScoreType, string> = {
  academy: '補習班',
  school: '學校考試',
};

/** 段考沒有班，歸在這一組（放最後） */
export const SCHOOL_GROUP = '學校段考';

export interface ClassGroup {
  readonly name: string;
  readonly records: ParentScoreRecord[];
}

export const classOf = (record: ParentScoreRecord): string => record.className ?? SCHOOL_GROUP;

/** 依課程分組（A6：照規格按課程），組內保持原順序（API 已新到舊）；學校段考放最後 */
export function groupByClass(records: readonly ParentScoreRecord[]): ClassGroup[] {
  const byName = new Map<string, ParentScoreRecord[]>();
  for (const record of records) {
    const bucket = byName.get(classOf(record));
    if (bucket) bucket.push(record);
    else byName.set(classOf(record), [record]);
  }
  return [...byName]
    .map(([name, rs]) => ({ name, records: rs }))
    .sort((a, b) => Number(a.name === SCHOOL_GROUP) - Number(b.name === SCHOOL_GROUP));
}

export type RangeFilter = 'all' | '1' | '3' | '6';

export const RANGE_OPTIONS: ReadonlyArray<{ value: RangeFilter; label: string }> = [
  { value: '1', label: '近 1 月' },
  { value: '3', label: '近 3 月' },
  { value: '6', label: '近半年' },
  { value: 'all', label: '全部' },
];

/** 期間切換：考試日在「今天往前 30×N 天」內（A6 `PER`） */
export function filterByRange(
  records: readonly ParentScoreRecord[],
  range: RangeFilter,
  today: string,
): ParentScoreRecord[] {
  if (range === 'all') return [...records];
  const from = addDaysToDateString(today, -30 * Number(range));
  return records.filter((r) => r.examDate.slice(0, 10) >= from);
}

/** 登錄日（台北日曆日）。`createdAt` 是 UTC 時刻，直接切字串會在清晨差一天 */
export const recordedOn = (record: ParentScoreRecord): string =>
  taipeiDateString(Date.parse(record.createdAt));

/** NEW：登錄日在 7 天內（今天算第一天，所以往前 6 天） */
export function isNewRecord(record: ParentScoreRecord, today: string): boolean {
  return recordedOn(record) >= addDaysToDateString(today, -6);
}

/** `YYYY-MM-DD`（或帶時間的 ISO 字串）→ `M/D` */
export const monthDay = (date: string): string => `${+date.slice(5, 7)}/${+date.slice(8, 10)}`;
