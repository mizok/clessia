import { countUntakenSessions } from './dashboard.util';
import type { EventSessionSummary } from '@core/attendance.service';

function session(overrides: Partial<EventSessionSummary> = {}): EventSessionSummary {
  return {
    eventId: 'e1',
    classId: 'c1',
    className: '數學班 A',
    courseName: '數學',
    teacherName: '王老師',
    campusId: null,
    campusName: null,
    eventDate: '2026-08-25',
    startTime: '09:00',
    endTime: '11:00',
    enrolledCount: 8,
    presentCount: 0,
    onLeaveCount: 0,
    absentCount: 0,
    takenAt: null,
    ...overrides,
  };
}

/** 2026-08-29 週六中午；回溯 7 天的窗是 08-22 ~ 08-29 */
const NOON = new Date('2026-08-29T12:00:00');

describe('countUntakenSessions', () => {
  it('上完了又沒點名的算漏點名', () => {
    expect(countUntakenSessions([session()], 'per_session', NOON)).toBe(1);
  });

  it('點過名的不算', () => {
    const taken = session({ takenAt: '2026-08-25T11:05:00Z' });

    expect(countUntakenSessions([taken], 'per_session', NOON)).toBe(0);
  });

  // 全班缺席也是點過名 —— 用 presentCount 判斷會把它誤判成沒點名
  it('全班缺席但有點名，不算漏點名', () => {
    const taken = session({ takenAt: '2026-08-25T11:05:00Z', absentCount: 8 });

    expect(countUntakenSessions([taken], 'per_session', NOON)).toBe(0);
  });

  // 還沒上完的課當然沒點名，算進去會讓卡片整天都在誤報
  it('今天還沒結束的課不算漏點名', () => {
    const tonight = session({ eventDate: '2026-08-29', startTime: '19:00', endTime: '21:00' });

    expect(countUntakenSessions([tonight], 'per_session', NOON)).toBe(0);
  });

  it('今天已經結束的課算漏點名', () => {
    const morning = session({ eventDate: '2026-08-29', startTime: '09:00', endTime: '11:00' });

    expect(countUntakenSessions([morning], 'per_session', NOON)).toBe(1);
  });

  it('剛好結束在此刻的課算漏點名', () => {
    const justEnded = session({ eventDate: '2026-08-29', startTime: '10:00', endTime: '12:00' });

    expect(countUntakenSessions([justEnded], 'per_session', NOON)).toBe(1);
  });

  // 沒有結束時間就無從判斷今天那堂上完了沒，等這天過完再算
  it('沒有結束時間的課，當天不算、隔天才算', () => {
    const today = session({ eventDate: '2026-08-29', startTime: null, endTime: null });
    const yesterday = session({ eventDate: '2026-08-28', startTime: null, endTime: null });

    expect(countUntakenSessions([today], 'per_session', NOON)).toBe(0);
    expect(countUntakenSessions([yesterday], 'per_session', NOON)).toBe(1);
  });

  // 跨午夜的課結束在隔天，用當天的日期比會提早誤判成已結束
  it('跨午夜的課要算到隔天才結束', () => {
    const overnight = session({ eventDate: '2026-08-29', startTime: '22:00', endTime: '00:30' });

    expect(countUntakenSessions([overnight], 'per_session', NOON)).toBe(0);

    const nextNoon = new Date('2026-08-30T12:00:00');
    expect(countUntakenSessions([overnight], 'per_session', nextNoon)).toBe(1);
  });

  // daily-checkins 建立 attendance_records 但從不蓋 events.attendance_taken_at，
  // 這個模式下每一堂推算出席的課都會被誤判成漏點名 —— 整張卡不該存在
  it('日到班模式回傳 null（卡片不渲染）', () => {
    expect(countUntakenSessions([session()], 'daily_checkin', NOON)).toBeNull();
  });

  it('日到班模式即使沒有課堂也回傳 null，不是 0', () => {
    expect(countUntakenSessions([], 'daily_checkin', NOON)).toBeNull();
  });

  it('沒有課堂時是 0', () => {
    expect(countUntakenSessions([], 'per_session', NOON)).toBe(0);
  });
});
