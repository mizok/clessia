import type { ParentAttendanceRecord } from '@core/parent-attendance.service';
import { ATTENDANCE_STATUS_TONE, groupByDate } from './attendance.util';

const record = (overrides: Partial<ParentAttendanceRecord> = {}): ParentAttendanceRecord => ({
  id: 'r1',
  eventId: 'e1',
  eventDate: '2026-09-01',
  startTime: '09:00',
  endTime: '10:00',
  campusName: '台北校',
  className: '數學班',
  status: 'present',
  note: null,
  ...overrides,
});

describe('attendance.util', () => {
  describe('groupByDate', () => {
    it('依日期分組，同一天的課堂在同一組', () => {
      const groups = groupByDate([
        record({ id: 'r1', eventDate: '2026-09-01' }),
        record({ id: 'r2', eventDate: '2026-09-01' }),
        record({ id: 'r3', eventDate: '2026-08-30' }),
      ]);

      expect(groups).toHaveLength(2);
      expect(groups[0].records.map((r) => r.id)).toEqual(['r1', 'r2']);
    });

    it('日期新到舊排序', () => {
      const groups = groupByDate([
        record({ id: 'r1', eventDate: '2026-08-30' }),
        record({ id: 'r2', eventDate: '2026-09-01' }),
      ]);

      expect(groups.map((g) => g.date)).toEqual(['2026-09-01', '2026-08-30']);
    });

    it('空陣列回空陣列', () => {
      expect(groupByDate([])).toEqual([]);
    });
  });

  describe('ATTENDANCE_STATUS_TONE', () => {
    it('缺席比請假嚴重，請假比出席嚴重——跟 schedule.util 的 DAY_TONE_PRIORITY 同一個判準', () => {
      expect(ATTENDANCE_STATUS_TONE.absent).toBe('overdue');
      expect(ATTENDANCE_STATUS_TONE.on_leave).toBe('pending');
      expect(ATTENDANCE_STATUS_TONE.present).toBe('done');
    });

    it('沒有「遲到」——值域只有三個 key', () => {
      expect(Object.keys(ATTENDANCE_STATUS_TONE).sort()).toEqual(['absent', 'on_leave', 'present']);
    });
  });
});
