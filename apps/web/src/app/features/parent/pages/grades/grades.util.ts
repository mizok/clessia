import { subMonths } from 'date-fns';
import type {
  ParentScoreRecord,
  ParentScoreStatus,
  ParentScoreType,
} from '@core/parent-grades.service';

export type TimeRange = 'all' | '1m' | '3m' | '6m';

export const TIME_RANGE_OPTIONS: Array<{ label: string; value: TimeRange }> = [
  { label: '近1月', value: '1m' },
  { label: '近3月', value: '3m' },
  { label: '近半年', value: '6m' },
  { label: '全部', value: 'all' },
];

export const SCORE_STATUS_LABELS: Record<ParentScoreStatus, string> = {
  scored: '已登錄',
  absent: '缺考',
  makeup: '補考',
};

export const SCORE_TYPE_LABELS: Record<ParentScoreType, string> = {
  academy: '補習班',
  school: '學校考試',
};

/** 時間範圍篩選——照抄 `student-score-detail-dialog` 的既有 TIME_RANGE_OPTIONS pattern，
 * 取代規格原本要的「學期」（那是計費期間的概念，跟學期是兩件事，不該混用） */
export function filterByTimeRange(
  records: readonly ParentScoreRecord[],
  range: TimeRange,
  now: Date,
): ParentScoreRecord[] {
  if (range === 'all') return [...records];
  const months = range === '1m' ? 1 : range === '3m' ? 3 : 6;
  const cutoff = subMonths(now, months);
  return records.filter((record) => new Date(record.examDate) >= cutoff);
}

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
