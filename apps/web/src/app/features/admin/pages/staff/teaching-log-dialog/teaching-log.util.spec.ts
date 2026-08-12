import type { Session } from '@core/sessions.service';

import { summariseTeachingLog } from './teaching-log.util';

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    sessionDate: '2026-08-01',
    startTime: '19:00',
    endTime: '21:00',
    status: 'completed',
    assignmentStatus: 'assigned',
    classId: 'c1',
    className: '國二數學 A',
    courseId: 'course-1',
    courseName: '國二數學',
    campusId: 'campus-1',
    campusName: '示範分校',
    teacherId: 't1',
    teacherName: '王小明',
    hasChanges: false,
    attendanceTakenAt: '2026-08-01T11:05:00.000Z',
    ...overrides,
  };
}

describe('summariseTeachingLog', () => {
  it('加總排定時數，一堂兩小時算 2', () => {
    const result = summariseTeachingLog([session()]);

    expect(result.totalHours).toBe(2);
    expect(result.countedSessions).toBe(1);
  });

  it('用排定時間而非點名時間計算 —— 忘記點名不該讓這堂課消失', () => {
    const result = summariseTeachingLog([session({ attendanceTakenAt: null })]);

    expect(result.totalHours).toBe(2);
    expect(result.countedSessions).toBe(1);
    // 但要標記出來，讓人去確認
    expect(result.missingAttendance).toHaveLength(1);
    expect(result.missingAttendance[0].id).toBe('s1');
  });

  it('停課列出來但不計入時數', () => {
    const result = summariseTeachingLog([
      session({ id: 'a' }),
      session({ id: 'b', status: 'cancelled' }),
    ]);

    expect(result.totalHours).toBe(2);
    expect(result.countedSessions).toBe(1);
    expect(result.cancelled).toHaveLength(1);
    expect(result.cancelled[0].id).toBe('b');
  });

  it('停課的課堂不算進「缺點名」—— 沒上的課本來就不會有點名', () => {
    const result = summariseTeachingLog([
      session({ id: 'b', status: 'cancelled', attendanceTakenAt: null }),
    ]);

    expect(result.missingAttendance).toHaveLength(0);
  });

  it('處理非整點的時段', () => {
    const result = summariseTeachingLog([
      session({ startTime: '18:30', endTime: '20:00' }), // 1.5
      session({ id: 's2', startTime: '09:15', endTime: '10:00' }), // 0.75
    ]);

    expect(result.totalHours).toBeCloseTo(2.25, 5);
  });

  it('跨午夜的時段不會算成負數', () => {
    // 補習班的課不太可能跨午夜，但結束時間早於開始時間就是資料有問題 ——
    // 算成負數會讓總時數莫名變少且很難察覺，寧可視為 0 並標記。
    const result = summariseTeachingLog([session({ startTime: '21:00', endTime: '19:00' })]);

    expect(result.totalHours).toBe(0);
    expect(result.invalidDuration).toHaveLength(1);
  });

  it('空清單回傳零值而不是拋錯', () => {
    const result = summariseTeachingLog([]);

    expect(result).toEqual({
      totalHours: 0,
      countedSessions: 0,
      counted: [],
      cancelled: [],
      missingAttendance: [],
      invalidDuration: [],
    });
  });

  it('依日期與開始時間排序，早的在前', () => {
    const result = summariseTeachingLog([
      session({ id: 'c', sessionDate: '2026-08-05', startTime: '19:00' }),
      session({ id: 'a', sessionDate: '2026-08-01', startTime: '19:00' }),
      session({ id: 'b', sessionDate: '2026-08-01', startTime: '09:00' }),
    ]);

    expect(result.counted.map((s) => s.id)).toEqual(['b', 'a', 'c']);
  });
});
