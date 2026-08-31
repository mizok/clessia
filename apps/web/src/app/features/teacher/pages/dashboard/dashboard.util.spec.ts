import { summariseTeacherWeek } from './dashboard.util';
import type { EventSessionSummary } from '@core/attendance.service';

function session(overrides: Partial<EventSessionSummary> = {}): EventSessionSummary {
  return {
    eventId: 'e1',
    sessionId: 's1',
    status: 'scheduled',
    isSubstitute: false,
    examCount: 0,
    classId: 'c1',
    className: '數學班 A',
    courseName: '數學',
    teacherName: '王老師',
    campusId: null,
    campusName: null,
    eventDate: '2026-08-18',
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

const TODAY = '2026-08-18';
const NOON = new Date('2026-08-18T12:00:00');

describe('summariseTeacherWeek', () => {
  it('今日課堂只算今天的，本週算全部', () => {
    const stats = summariseTeacherWeek(
      [session(), session({ eventId: 'e2', eventDate: '2026-08-19' })],
      TODAY,
      NOON,
    );

    expect(stats.todayTotal).toBe(1);
    expect(stats.weekTotal).toBe(2);
  });

  it('已開始又沒點名的算待辦', () => {
    const stats = summariseTeacherWeek(
      [session({ startTime: '09:00', takenAt: null })],
      TODAY,
      NOON,
    );

    expect(stats.todayPending).toBe(1);
  });

  // 還沒上的課當然沒點名，算進待辦只會讓數字整天都嚇人
  it('還沒開始的課不算待辦', () => {
    const stats = summariseTeacherWeek(
      [session({ startTime: '19:00', takenAt: null })],
      TODAY,
      NOON,
    );

    expect(stats.todayPending).toBe(0);
  });

  it('點過名的不算待辦', () => {
    const stats = summariseTeacherWeek(
      [session({ startTime: '09:00', takenAt: '2026-08-18T09:05:00Z' })],
      TODAY,
      NOON,
    );

    expect(stats.todayPending).toBe(0);
  });

  // 全班缺席也是點過名，用 presentCount 判斷會把它誤判成沒點名
  it('全班缺席但有點名，不算待辦', () => {
    const stats = summariseTeacherWeek(
      [session({ startTime: '09:00', takenAt: '2026-08-18T09:05:00Z', absentCount: 8 })],
      TODAY,
      NOON,
    );

    expect(stats.todayPending).toBe(0);
  });

  it('沒有時間的課堂視為已開始', () => {
    const stats = summariseTeacherWeek([session({ startTime: null })], TODAY, NOON);

    expect(stats.todayPending).toBe(1);
  });

  it('沒有課堂時全部是 0', () => {
    expect(summariseTeacherWeek([], TODAY, NOON)).toEqual({
      todayTotal: 0,
      todayPending: 0,
      weekTotal: 0,
    });
  });
});
