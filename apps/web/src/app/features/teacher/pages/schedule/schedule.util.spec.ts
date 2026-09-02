import { describe, expect, it } from 'vitest';
import type { EventSessionSummary } from '@core/attendance.service';

import {
  ATTENDANCE_TONE_LABELS,
  attendanceDisplay,
  attendanceTone,
  canTakeAttendance,
  daySummary,
  weekAnchor,
} from './schedule.util';

function session(over: Partial<EventSessionSummary>): EventSessionSummary {
  return {
    eventId: 'e1',
    sessionId: 's1',
    status: 'scheduled',
    isSubstitute: false,
    examCount: 0,
    classId: 'c1',
    className: '國三數學 A',
    courseName: null,
    teacherName: null,
    campusId: null,
    campusName: null,
    eventDate: '2026-08-31',
    startTime: '19:00',
    endTime: '21:00',
    enrolledCount: 12,
    presentCount: 0,
    onLeaveCount: 0,
    absentCount: 0,
    takenAt: null,
    ...over,
  };
}

describe('attendanceTone', () => {
  /**
   * 這一條是換掉 `isFuture` 的理由。舊的判定是 `!isPast(parseISO(eventDate))`，
   * 只比日期 —— 今晚七點的課從凌晨 00:00 起就被當成「已經開始、該點名了」。
   */
  it('今天晚上的課，早上還沒上完 → pending，不是 overdue', () => {
    const now = new Date('2026-08-31T08:00:00');
    expect(attendanceTone(session({}), now)).toBe('pending');
  });

  it('今天晚上的課，隔天早上仍沒點名 → overdue', () => {
    const now = new Date('2026-09-01T08:00:00');
    expect(attendanceTone(session({}), now)).toBe('overdue');
  });

  it('點過名就是 done，不管上完了沒', () => {
    const now = new Date('2026-08-31T08:00:00');
    expect(attendanceTone(session({ takenAt: '2026-08-31T21:05:00Z' }), now)).toBe('done');
  });

  /** 全班缺席不是「沒點名」—— 判定看 takenAt，不看 presentCount */
  it('全班缺席但點過名 → done', () => {
    const now = new Date('2026-09-01T08:00:00');
    expect(
      attendanceTone(
        session({ takenAt: '2026-08-31T21:05:00Z', presentCount: 0, absentCount: 12 }),
        now,
      ),
    ).toBe('done');
  });

  /** 跨午夜：23:00–01:00 結束在隔天，不是當天凌晨一點 */
  it('跨午夜的課在當天午夜前仍是 pending', () => {
    const now = new Date('2026-08-31T23:30:00');
    expect(attendanceTone(session({ startTime: '23:00', endTime: '01:00' }), now)).toBe('pending');
  });

  /** 沒有結束時間就無從判斷當天上完沒，當天內保守回 pending —— 假警示會讓人不再信這個標記 */
  it('沒有結束時間的課，當天內是 pending', () => {
    const now = new Date('2026-08-31T23:59:00');
    expect(attendanceTone(session({ endTime: null }), now)).toBe('pending');
  });

  it('沒有結束時間的課，隔天就算上完了 → overdue', () => {
    const now = new Date('2026-09-01T00:30:00');
    expect(attendanceTone(session({ endTime: null }), now)).toBe('overdue');
  });
});

describe('weekAnchor', () => {
  const now = new Date('2026-09-01T08:00:00');

  it('數整週，不是當日 —— 面板不追捲動位置，錨點就給整週', () => {
    expect(
      weekAnchor(
        [
          session({ eventId: 'a', eventDate: '2026-08-31' }),
          session({ eventId: 'b', eventDate: '2026-09-01', startTime: '19:00' }),
          session({ eventId: 'c', eventDate: '2026-09-02' }),
        ],
        now,
      ),
    ).toEqual({ total: 3, overdue: 1 });
  });

  it('沒有課的一週回 0，不是 undefined', () => {
    expect(weekAnchor([], now)).toEqual({ total: 0, overdue: 0 });
  });

  it('點過名的不計入 overdue', () => {
    expect(
      weekAnchor([session({ eventDate: '2026-08-31', takenAt: '2026-08-31T21:05:00Z' })], now),
    ).toEqual({ total: 1, overdue: 0 });
  });
});

describe('停課（#123 之後）', () => {
  const now = new Date('2026-09-01T08:00:00');

  /**
   * 這是接線最容易錯的一條：停課的課堂**永遠不會被點名**，
   * 把它算成「上完了卻沒點」是誣賴老師漏了一堂根本沒發生的課。
   */
  it('已過去的停課課堂不是 overdue，是 inactive', () => {
    expect(attendanceTone(session({ status: 'cancelled' }), now)).toBe('inactive');
  });

  it('未來的停課課堂也是 inactive，不是 pending', () => {
    expect(attendanceTone(session({ status: 'cancelled', eventDate: '2026-09-05' }), now)).toBe(
      'inactive',
    );
  });

  it('停課不計入週錨點的 overdue', () => {
    expect(
      weekAnchor(
        [
          session({ eventId: 'a', eventDate: '2026-08-31' }),
          session({ sessionId: 's2', status: 'cancelled', eventDate: '2026-08-31' }),
        ],
        now,
      ),
    ).toEqual({ total: 2, overdue: 1 });
  });
});

describe('canTakeAttendance', () => {
  it('停課的課堂點不了名 —— 後端刻意不補建出勤事件', () => {
    expect(canTakeAttendance(session({ status: 'cancelled', eventId: null }))).toBe(false);
  });

  /** 防守後端萬一回了 cancelled 卻帶著 eventId：語意上仍然不該點名 */
  it('狀態是停課就點不了名，就算有 eventId', () => {
    expect(canTakeAttendance(session({ status: 'cancelled', eventId: 'e1' }))).toBe(false);
  });

  it('沒有 eventId 就點不了名，不管狀態', () => {
    expect(canTakeAttendance(session({ eventId: null }))).toBe(false);
  });

  it('正常課堂點得了名', () => {
    expect(canTakeAttendance(session({}))).toBe(true);
  });
});

describe('ATTENDANCE_TONE_LABELS', () => {
  /**
   * 實測時抓到的 bug：`toneLabel` 原本是帶 `default` 的 switch，
   * 停課（inactive）掉進 default 顯示成「還沒上」—— 一堂停掉的課看起來像老師還沒去上。
   */
  it('停課說「已停課」，不是「還沒上」', () => {
    expect(ATTENDANCE_TONE_LABELS[attendanceTone(session({ status: 'cancelled' }), new Date())]).toBe(
      '已停課',
    );
  });

  it('每個 tone 都有字 —— 沒有 default 可以吞掉漏掉的那個', () => {
    for (const tone of ['done', 'pending', 'overdue', 'inactive', 'failed'] as const) {
      expect(ATTENDANCE_TONE_LABELS[tone]).toBeTruthy();
    }
  });
});

/**
 * 2026-09-02 UX 審查（阻斷級 A3）：`attendance_responsible = 'admin'` 時，
 * 老師的課表**完全沒有點名入口**，但狀態點照樣寫「漏點名」——
 * 頁面在對老師問責一件他做不到的事。
 *
 * 「這堂課點了沒」與「這是不是老師的責任」是兩個問題：
 * `attendanceTone` 只答前者，責任歸屬在 `attendanceDisplay`。
 */
describe('attendanceDisplay（帶責任歸屬）', () => {
  const now = new Date('2026-09-01T08:00:00');
  const pastUntaken = session({ eventDate: '2026-08-31' });

  it('老師負責點名時，過去沒點的是「漏點名」', () => {
    expect(attendanceDisplay(pastUntaken, now, true)).toEqual({
      tone: 'overdue',
      label: '漏點名',
    });
  });

  it('行政負責點名時，同一堂課變成中性的「未點名」，不是漏點名', () => {
    expect(attendanceDisplay(pastUntaken, now, false)).toEqual({
      tone: 'pending',
      label: '未點名',
    });
  });

  it('已點名兩種模式都一樣 —— 責任只影響「還沒做」的說法', () => {
    const taken = session({ eventDate: '2026-08-31', takenAt: '2026-08-31T12:00:00Z' });
    expect(attendanceDisplay(taken, now, true)).toEqual(attendanceDisplay(taken, now, false));
  });

  it('停課兩種模式都一樣', () => {
    const cancelled = session({ status: 'cancelled', eventDate: '2026-08-31' });
    expect(attendanceDisplay(cancelled, now, true)).toEqual({ tone: 'inactive', label: '已停課' });
    expect(attendanceDisplay(cancelled, now, false)).toEqual({ tone: 'inactive', label: '已停課' });
  });

  it('還沒上的課兩種模式都是「還沒上」', () => {
    const future = session({ eventDate: '2026-09-05' });
    expect(attendanceDisplay(future, now, true).label).toBe('還沒上');
    expect(attendanceDisplay(future, now, false).label).toBe('還沒上');
  });
});

/**
 * 桌機的週條：每天一格，顯示堂數與一顆狀態點。
 * （2026-09-02 使用者推翻七欄 —— 格子太小。桌機改成「週條 + 放大的單日」，
 * 跟手機同構。）
 *
 * 點的規則是**取最需要老師動作的那一個**，不是取多數 ——
 * 一天有三堂、其中一堂漏點名，老師要看到的是那一堂。
 */
describe('daySummary（週條每日彙總）', () => {
  const now = new Date('2026-09-01T08:00:00');

  it('沒有課 → 沒有點，堂數 0', () => {
    expect(daySummary([], now, true)).toEqual({ count: 0, tone: null });
  });

  it('一堂漏點名 → overdue', () => {
    expect(daySummary([session({ eventDate: '2026-08-31' })], now, true)).toEqual({
      count: 1,
      tone: 'overdue',
    });
  });

  /** 取最需要動作的那個，不是取多數 */
  it('兩堂已點名 + 一堂漏點名 → overdue', () => {
    const taken = { eventDate: '2026-08-31', takenAt: '2026-08-31T12:00:00Z' };
    expect(
      daySummary(
        [
          session({ ...taken, sessionId: 'a' }),
          session({ ...taken, sessionId: 'b' }),
          session({ eventDate: '2026-08-31', sessionId: 'c' }),
        ],
        now,
        true,
      ),
    ).toEqual({ count: 3, tone: 'overdue' });
  });

  it('全部已點名 → done', () => {
    expect(
      daySummary(
        [session({ eventDate: '2026-08-31', takenAt: '2026-08-31T12:00:00Z' })],
        now,
        true,
      ),
    ).toEqual({ count: 1, tone: 'done' });
  });

  it('還沒上的課 → pending', () => {
    expect(daySummary([session({ eventDate: '2026-09-05' })], now, true)).toEqual({
      count: 1,
      tone: 'pending',
    });
  });

  it('只有停課 → inactive，但堂數照算（它還在你的課表上）', () => {
    expect(
      daySummary([session({ eventDate: '2026-08-31', status: 'cancelled' })], now, true),
    ).toEqual({ count: 1, tone: 'inactive' });
  });

  /** 責任歸屬要一路傳到週條，不然行政負責時週條又在問責老師 */
  it('行政負責點名時，漏點名那天降成 pending', () => {
    expect(daySummary([session({ eventDate: '2026-08-31' })], now, false)).toEqual({
      count: 1,
      tone: 'pending',
    });
  });
});
