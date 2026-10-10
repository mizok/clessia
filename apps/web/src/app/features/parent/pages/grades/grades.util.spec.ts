import type { ParentGradePeriod, ParentScoreRecord } from '@core/parent-grades.service';
import {
  defaultPeriodFilter,
  filterByPeriod,
  groupByClass,
  isNewRecord,
  filterByRange,
  periodOptions,
} from './grades.util';

const record = (overrides: Partial<ParentScoreRecord> = {}): ParentScoreRecord => ({
  id: 'r1',
  type: 'academy',
  examName: '第一次段考',
  examDate: '2026-09-01',
  subjectName: '數學',
  className: '數學班',
  createdAt: '2026-09-01T02:00:00Z',
  score: 88,
  totalScore: 100,
  status: 'scored',
  description: null,
  ...overrides,
});

describe('grades.util', () => {
  describe('groupByClass', () => {
    it('依課程分組、同課程合併；段考（沒有班）歸「學校段考」放最後', () => {
      const groups = groupByClass([
        record({ id: 'r1', className: null, type: 'school' }),
        record({ id: 'r2', className: '英文班' }),
        record({ id: 'r3', className: '英文班' }),
      ]);
      expect(groups.map((g) => g.name)).toEqual(['英文班', '學校段考']);
      expect(groups[0].records.map((r) => r.id)).toEqual(['r2', 'r3']);
    });
  });

  describe('期間與 NEW', () => {
    it('近 N 月＝考試日在今天往前 30×N 天內', () => {
      const rs = [
        record({ id: 'in', examDate: '2026-08-12' }),
        record({ id: 'out', examDate: '2026-08-10' }),
      ];
      expect(filterByRange(rs, '1', '2026-09-10').map((r) => r.id)).toEqual(['in']);
      expect(filterByRange(rs, 'all', '2026-09-10')).toHaveLength(2);
    });

    it('NEW＝登錄日（台北）在 7 天內；UTC 晚上算隔天', () => {
      expect(isNewRecord(record({ createdAt: '2026-09-04T00:00:00Z' }), '2026-09-10')).toBe(true);
      expect(isNewRecord(record({ createdAt: '2026-09-03T00:00:00Z' }), '2026-09-10')).toBe(false);
      // 09-03 16:30 UTC＝台北 09-04 00:30 → 算 09-04，在 7 天內
      expect(isNewRecord(record({ createdAt: '2026-09-03T16:30:00Z' }), '2026-09-10')).toBe(true);
    });
  });

  describe('期篩選（#1076：學期＝機構的期 billing_periods）', () => {
    const FALL: ParentGradePeriod = {
      id: 'fall',
      name: '115 上學期',
      startDate: '2026-08-01',
      endDate: '2027-01-31',
    };
    const SPRING: ParentGradePeriod = {
      id: 'spring',
      name: '114 下學期',
      startDate: '2026-02-01',
      endDate: '2026-07-31',
    };
    /** 期允許重疊（migration 刻意不擋）—— 過渡期 */
    const BRIDGE: ParentGradePeriod = {
      id: 'bridge',
      name: '暑期銜接',
      startDate: '2026-07-01',
      endDate: '2026-08-31',
    };

    it('選某個期：只留考試日期落在起訖內的（含頭尾）', () => {
      const result = filterByPeriod(
        [
          record({ id: 'start', examDate: '2026-08-01' }),
          record({ id: 'end', examDate: '2027-01-31' }),
          record({ id: 'before', examDate: '2026-07-31' }),
        ],
        'fall',
        [FALL, SPRING],
      );
      expect(result.map((r) => r.id)).toEqual(['start', 'end']);
    });

    it('期重疊：同一筆考試在兩個期都看得到', () => {
      const exam = record({ id: 'x', examDate: '2026-08-15' });
      expect(filterByPeriod([exam], 'fall', [FALL, BRIDGE])).toHaveLength(1);
      expect(filterByPeriod([exam], 'bridge', [FALL, BRIDGE])).toHaveLength(1);
    });

    it('未分期：沒有任何期涵蓋的考試', () => {
      const result = filterByPeriod(
        [
          record({ id: 'in', examDate: '2026-09-01' }),
          record({ id: 'out', examDate: '2025-05-01' }),
        ],
        'unassigned',
        [FALL, SPRING],
      );
      expect(result.map((r) => r.id)).toEqual(['out']);
    });

    it('全部：不過濾', () => {
      expect(filterByPeriod([record({ examDate: '2020-01-01' })], 'all', [FALL])).toHaveLength(1);
    });

    it('選項＝全部＋各期＋未分期；沒有未分期的考試就不出現「未分期」', () => {
      const withOrphan = periodOptions([FALL, SPRING], [record({ examDate: '2025-05-01' })]);
      expect(withOrphan.map((o) => o.value)).toEqual(['all', 'fall', 'spring', 'unassigned']);
      expect(withOrphan.map((o) => o.label)).toEqual([
        '全部',
        '115 上學期',
        '114 下學期',
        '未分期',
      ]);

      const covered = periodOptions([FALL], [record({ examDate: '2026-09-01' })]);
      expect(covered.map((o) => o.value)).toEqual(['all', 'fall']);
    });

    it('預設＝含今天的期；重疊時取起始日最晚的；沒有期涵蓋今天 → 全部', () => {
      expect(defaultPeriodFilter([FALL, SPRING], '2026-03-10')).toBe('spring');
      expect(defaultPeriodFilter([FALL, BRIDGE, SPRING], '2026-08-15')).toBe('fall');
      expect(defaultPeriodFilter([FALL, SPRING], '2025-12-01')).toBe('all');
      expect(defaultPeriodFilter([], '2026-03-10')).toBe('all');
    });
  });
});
