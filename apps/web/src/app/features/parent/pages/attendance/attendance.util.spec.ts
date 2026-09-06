import type { ParentAttendanceRecord } from '@core/parent-attendance.service';
import {
  ATTENDANCE_STATUS_TONE,
  fillMissingDays,
  groupByDate,
  sessionChipLabel,
} from './attendance.util';

const record = (overrides: Partial<ParentAttendanceRecord> = {}): ParentAttendanceRecord => ({
  id: 'r1',
  eventId: 'e1',
  eventDate: '2026-09-01',
  startTime: '09:00',
  endTime: '10:00',
  campusName: '台北校',
  className: '數學班',
  sessionStatus: 'scheduled',
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

  describe('fillMissingDays', () => {
    it('補回沒有紀錄的日期，新到舊', () => {
      const groups = fillMissingDays(
        [{ date: '2026-09-05', records: [record({ id: 'r1' })] }],
        '2026-09-03',
        '2026-09-05',
      );

      expect(groups.map((g) => g.date)).toEqual(['2026-09-05', '2026-09-04', '2026-09-03']);
      expect(groups[1].records).toEqual([]);
    });

    it('有紀錄的日期不動', () => {
      const groups = fillMissingDays(
        [
          { date: '2026-09-05', records: [record({ id: 'r1' })] },
          { date: '2026-09-04', records: [record({ id: 'r2' })] },
        ],
        '2026-09-04',
        '2026-09-05',
      );

      expect(groups.every((g) => g.records.length === 1)).toBe(true);
    });

    it('全部都沒有紀錄時每天都是空的（不是漏掉整段區間）', () => {
      const groups = fillMissingDays([], '2026-09-03', '2026-09-05');

      expect(groups).toHaveLength(3);
      expect(groups.every((g) => g.records.length === 0)).toBe(true);
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

describe('sessionChipLabel', () => {
  it('停課要標，正常的兩種都不標', () => {
    expect(sessionChipLabel('cancelled')).toBe('停課');
    expect(sessionChipLabel('scheduled')).toBeNull();
    expect(sessionChipLabel('completed')).toBeNull();
  });

  it('null 有自己的標籤，不落進 scheduled', () => {
    // 落進 scheduled 的話，「這不是課堂」跟「這是一堂正常的課」會長得一樣
    expect(sessionChipLabel(null)).toBe('非課堂');
    expect(sessionChipLabel(null)).not.toBe(sessionChipLabel('scheduled'));
  });
});
