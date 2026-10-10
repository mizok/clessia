import type { ParentSession } from '@core/parent-sessions.service';
import {
  changeLabels,
  changeText,
  heroOf,
  mondayOf,
  sessionPhase,
  taipeiMinutes,
  weekDates,
} from './schedule.util';

function session(over: Partial<ParentSession> = {}): ParentSession {
  return {
    sessionId: 's1',
    date: '2026-10-08',
    startTime: '17:00:00',
    endTime: '18:30:00',
    status: 'scheduled',
    classId: 'c1',
    className: '國三數學 B 班',
    courseName: '國中數學',
    campusName: '文山旗艦校',
    teacherName: '游佩珊',
    isSubstitute: false,
    originalTeacherName: null,
    examCount: 0,
    changes: [],
    attendance: null,
    ...over,
  };
}

describe('schedule.util', () => {
  it('mondayOf：週日算上一個週一、週一就是自己', () => {
    expect(mondayOf('2026-10-11')).toBe('2026-10-05'); // 週日
    expect(mondayOf('2026-10-05')).toBe('2026-10-05'); // 週一
    expect(mondayOf('2026-10-08')).toBe('2026-10-05');
    expect(weekDates('2026-10-05')).toHaveLength(7);
    expect(weekDates('2026-10-05')[6]).toBe('2026-10-11');
  });

  it('taipeiMinutes：UTC 09:30 ＝ 台北 17:30', () => {
    expect(taipeiMinutes(Date.parse('2026-10-08T09:30:00Z'))).toBe(17 * 60 + 30);
  });

  describe('sessionPhase', () => {
    const today = '2026-10-08';
    it('停課（status 或異動）一律 off，不管幾點', () => {
      expect(sessionPhase(session({ status: 'cancelled' }), today, 600)).toBe('off');
      expect(
        sessionPhase(
          session({
            changes: [
              {
                changeType: 'cancellation',
                originalDate: null,
                originalStartTime: null,
                originalEndTime: null,
                newDate: null,
                newStartTime: null,
                newEndTime: null,
              },
            ],
          }),
          today,
          600,
        ),
      ).toBe('off');
    });
    it('今天：開始前 future、上課中 live、下課（含剛好下課那分）past', () => {
      expect(sessionPhase(session(), today, 16 * 60 + 59)).toBe('future');
      expect(sessionPhase(session(), today, 17 * 60)).toBe('live');
      expect(sessionPhase(session(), today, 18 * 60 + 29)).toBe('live');
      expect(sessionPhase(session(), today, 18 * 60 + 30)).toBe('past');
    });
    it('別天：昨天 past、明天 future', () => {
      expect(sessionPhase(session({ date: '2026-10-07' }), today, 600)).toBe('past');
      expect(sessionPhase(session({ date: '2026-10-09' }), today, 1200)).toBe('future');
    });
  });

  describe('heroOf', () => {
    it('上課中優先；沒有就找下一堂（停課的不算）；都沒有 none', () => {
      const live = session({ sessionId: 'live' });
      const later = session({ sessionId: 'later', date: '2026-10-09' });
      const off = session({
        sessionId: 'off',
        date: '2026-10-08',
        startTime: '19:00:00',
        status: 'cancelled',
      });
      expect(heroOf([later, live], '2026-10-08', 17 * 60 + 10)).toMatchObject({
        kind: 'live',
        session: { sessionId: 'live' },
      });
      expect(heroOf([later, off], '2026-10-08', 12 * 60)).toMatchObject({
        kind: 'next',
        session: { sessionId: 'later' },
      });
      expect(heroOf([off], '2026-10-08', 12 * 60)).toEqual({ kind: 'none' });
    });
  });

  it('changeLabels：代課旗標與 substitute 異動只留一個；停課 status 也有標', () => {
    expect(changeLabels(session({ isSubstitute: true }))).toEqual(['代課']);
    expect(changeLabels(session({ status: 'cancelled' }))).toEqual(['停課']);
    expect(changeLabels(session())).toEqual([]);
  });

  it('changeText：改期寫從哪天幾點到哪天幾點', () => {
    const s = session();
    expect(
      changeText(
        {
          changeType: 'reschedule',
          originalDate: '2026-10-07',
          originalStartTime: '19:00:00',
          originalEndTime: '20:30:00',
          newDate: '2026-10-08',
          newStartTime: '19:00:00',
          newEndTime: '20:30:00',
        },
        s,
      ),
    ).toBe('從 10/7 19:00 改到 10/8 19:00');
  });
});
