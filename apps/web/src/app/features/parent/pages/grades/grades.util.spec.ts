import type { ParentScoreRecord } from '@core/parent-grades.service';
import { filterByTimeRange, groupBySubject } from './grades.util';

const record = (overrides: Partial<ParentScoreRecord> = {}): ParentScoreRecord => ({
  id: 'r1',
  type: 'academy',
  examName: '第一次段考',
  examDate: '2026-09-01',
  subjectName: '數學',
  score: 88,
  totalScore: 100,
  status: 'scored',
  ...overrides,
});

describe('grades.util', () => {
  describe('groupBySubject', () => {
    it('依科目分組，同科目合併成一組', () => {
      const groups = groupBySubject([
        record({ id: 'r1', subjectName: '英文' }),
        record({ id: 'r2', subjectName: '數學' }),
        record({ id: 'r3', subjectName: '數學' }),
      ]);

      expect(groups).toHaveLength(2);
      const math = groups.find((g) => g.subjectName === '數學');
      expect(math?.records.map((r) => r.id)).toEqual(['r2', 'r3']);
    });

    it('沒有科目（null）分到「未分類」，放最後', () => {
      const groups = groupBySubject([
        record({ id: 'r1', subjectName: null }),
        record({ id: 'r2', subjectName: '數學' }),
      ]);

      expect(groups.map((g) => g.subjectName)).toEqual(['數學', '未分類']);
    });
  });

  describe('filterByTimeRange', () => {
    const now = new Date('2026-09-05T12:00:00');

    it('all 不過濾', () => {
      const result = filterByTimeRange([record({ examDate: '2020-01-01' })], 'all', now);
      expect(result).toHaveLength(1);
    });

    it('1m 只留近一個月內的', () => {
      const result = filterByTimeRange(
        [record({ id: 'a', examDate: '2026-09-01' }), record({ id: 'b', examDate: '2026-06-01' })],
        '1m',
        now,
      );
      expect(result.map((r) => r.id)).toEqual(['a']);
    });
  });
});
