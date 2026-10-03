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

export interface SubjectGroup {
  readonly subjectName: string;
  readonly records: ParentScoreRecord[];
}

/** 依科目分組，「未分類」（subjectName 為 null）放最後 */
export function groupBySubject(records: readonly ParentScoreRecord[]): SubjectGroup[] {
  const byName = new Map<string, ParentScoreRecord[]>();
  for (const record of records) {
    const key = record.subjectName ?? '__uncategorized__';
    const bucket = byName.get(key);
    if (bucket) bucket.push(record);
    else byName.set(key, [record]);
  }

  const names = Array.from(byName.keys()).sort((a, b) => {
    if (a === '__uncategorized__') return 1;
    if (b === '__uncategorized__') return -1;
    return a.localeCompare(b, 'zh-Hant');
  });

  return names.map((name) => ({
    subjectName: name === '__uncategorized__' ? '未分類' : name,
    records: byName.get(name)!,
  }));
}
