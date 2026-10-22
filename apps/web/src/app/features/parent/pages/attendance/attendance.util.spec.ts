import type { ParentAttendanceRecord } from '@core/parent-attendance.service';
import type { ParentSession } from '@core/parent-sessions.service';
import {
  ATTENDANCE_STATUS_TONE,
  arrivalLine,
  buildDays,
  heroLine,
  sessionChipLabel,
} from './attendance.util';

const record = (overrides: Partial<ParentAttendanceRecord> = {}): ParentAttendanceRecord => ({
  id: 'r1',
  eventId: 'e1',
  eventDate: '2026-09-01',
  startTime: '09:00',
  endTime: '10:00',
  campusId: 'daily',
  campusName: '台北校',
  className: '數學班',
  sessionStatus: 'scheduled',
  status: 'present',
  note: null,
  leaveSubmittedBy: null,
  leaveReason: null,
  ...overrides,
});

describe('attendance.util', () => {
  const DAILY = new Set(['daily']);

  describe('arrivalLine（設計稿 §1 四種字）', () => {
    it('有刷卡 → HH:mm 到班', () => {
      expect(arrivalLine([record()], '16:42', DAILY, false)).toEqual({
        text: '16:42 到班',
        missing: false,
      });
    });

    it('沒刷卡：全是請假或停課 → 這天不用到；今天 → 還沒到班；過去 → 沒有到班紀錄', () => {
      const off = [record({ status: 'on_leave' }), record({ sessionStatus: 'cancelled' })];
      expect(arrivalLine(off, undefined, DAILY, false)?.text).toBe('這天不用到');
      expect(arrivalLine([record()], undefined, DAILY, true)).toEqual({
        text: '還沒到班',
        missing: true,
      });
      expect(arrivalLine([record()], undefined, DAILY, false)?.text).toBe('沒有到班紀錄');
    });

    it('兩堂只請了一堂、沒刷卡 → 不是「這天不用到」（另一堂要到）', () => {
      const half = [record({ status: 'on_leave' }), record({ id: 'r2' })];
      expect(arrivalLine(half, undefined, DAILY, false)?.text).toBe('沒有到班紀錄');
    });

    it('當天的課全在隨堂點名分校 → 不畫（就算有刷卡）；有一堂在日到班分校就畫', () => {
      const session = record({ campusId: 'per-session' });
      expect(arrivalLine([session], '16:42', DAILY, false)).toBeNull();
      expect(arrivalLine([session, record()], undefined, DAILY, false)?.text).toBe('沒有到班紀錄');
      expect(arrivalLine([record({ campusId: null })], '16:42', DAILY, false)).toBeNull();
    });
  });

  describe('buildDays（一天一章）', () => {
    it('期間內每一天新到舊；沒課的日子 records 空、不畫到班行；當天照上課時間排', () => {
      const days = buildDays(
        [
          record({ id: 'b', eventDate: '2026-10-21', startTime: '18:00' }),
          record({ id: 'a', eventDate: '2026-10-21', startTime: '16:00' }),
        ],
        new Map([['2026-10-21', '15:50']]),
        DAILY,
        '2026-10-20',
        '2026-10-22',
        '2026-10-22',
      );

      expect(days.map((d) => [d.date, d.md, d.weekday, d.isToday])).toEqual([
        ['2026-10-22', '10/22', '四', true],
        ['2026-10-21', '10/21', '三', false],
        ['2026-10-20', '10/20', '二', false],
      ]);
      expect(days[1]!.records.map((r) => r.id)).toEqual(['a', 'b']);
      expect(days[1]!.arrival?.text).toBe('15:50 到班');
      expect(days[0]!.arrival).toBeNull();
    });
  });

  describe('heroLine（色面句，設計稿 §3）', () => {
    const session = (o: Partial<ParentSession> = {}) =>
      ({ startTime: '17:00', campusId: 'daily', attendance: null, ...o }) as ParentSession;

    it('今天沒課 → 今天沒有課。', () => {
      expect(heroLine([], undefined, DAILY, '10:00')).toBe('今天沒有課。');
    });

    it('有刷卡 → 今天 HH:mm 到班。；全請假 → 今天請假。', () => {
      expect(heroLine([session()], '16:41', DAILY, '17:30')).toBe('今天 16:41 到班。');
      expect(
        heroLine(
          [session({ attendance: { status: 'on_leave', checkedInAt: null } })],
          undefined,
          DAILY,
          '10:00',
        ),
      ).toBe('今天請假。');
    });

    it('還沒刷卡：第一堂還沒開始 → 寫幾點上課；已經開始 → 今天還沒到班。', () => {
      const two = [session({ startTime: '18:00' }), session({ startTime: '17:00' })];
      expect(heroLine(two, undefined, DAILY, '10:00')).toBe('今天還沒到，17:00 上課。');
      expect(heroLine(two, undefined, DAILY, '17:05')).toBe('今天還沒到班。');
    });

    it('今天的課都在隨堂點名分校 → null（標題退回「到班紀錄」）', () => {
      expect(heroLine([session({ campusId: 'per-session' })], '16:41', DAILY, '17:30')).toBeNull();
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
