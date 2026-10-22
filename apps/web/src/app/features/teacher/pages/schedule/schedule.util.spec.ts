import { describe, expect, it } from 'vitest';
import type { EventSessionSummary } from '@core/attendance.service';
import type { ChangeLogEntry } from '@core/sessions.service';

import {
  ATTENDANCE_TONE_LABELS,
  arrivalLine,
  attendanceDisplay,
  attendanceTone,
  canTakeAttendance,
  canWriteClassLog,
  canWriteContactBook,
  changeItems,
  daySummary,
  isDailyCheckin,
  nextSession,
  openerLine,
  sessionStateText,
  sortByStart,
  taipeiWallClock,
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
    usesContactBook: false,
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
    attendanceMode: 'per_session',
    checkedInCount: null,
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
    expect(
      ATTENDANCE_TONE_LABELS[attendanceTone(session({ status: 'cancelled' }), new Date())],
    ).toBe('已停課');
  });

  it('每個 tone 都有字 —— 沒有 default 可以吞掉漏掉的那個', () => {
    for (const tone of ['done', 'pending', 'overdue', 'inactive'] as const) {
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

/**
 * 課堂卡上「寫日誌」入口的分流條件。
 *
 * 這一段刻意跟 `canTakeAttendance` 分開測：兩者只有「停課」那一半重疊，
 * **日誌不需要 `eventId`** —— 它掛班×日期，不掛出勤事件。
 */
describe('教務日誌入口的分流', () => {
  it('日誌模式的正常課堂 → 顯示', () => {
    expect(canWriteClassLog({ status: 'scheduled', usesContactBook: false })).toBe(true);
  });

  // 班級設定決定要寫哪一種，不問老師。聯絡簿模式的撰寫端是 v1c
  it('聯絡簿模式 → 不顯示（刻意不做，不是遺漏）', () => {
    expect(canWriteClassLog({ status: 'scheduled', usesContactBook: true })).toBe(false);
  });

  it('停課 → 不顯示（不會發生的課沒有教學紀錄可寫）', () => {
    expect(canWriteClassLog({ status: 'cancelled', usesContactBook: false })).toBe(false);
  });

  /**
   * 已結束的課堂照樣可寫 —— 補寫昨天的日誌是常態，
   * 而且規則明說「老師可能先寫作業、下課後再補教學紀錄」，未來的課也可寫。
   */
  it('完成的課堂 → 仍然顯示', () => {
    expect(canWriteClassLog({ status: 'completed', usesContactBook: false })).toBe(true);
  });
});

/**
 * 兩型的入口**互斥**：同一張卡上不會同時出現「寫日誌」與「寫聯絡簿」。
 * 這一條測的是那個互斥性本身 —— 兩個判準各自對，仍然可能同時為真或同時為假。
 */
describe('兩型入口互斥', () => {
  const both = (s: { status: string; usesContactBook: boolean }) => [
    canWriteClassLog(s as never),
    canWriteContactBook(s as never),
  ];

  it('日誌模式 → 只有日誌', () => {
    expect(both({ status: 'scheduled', usesContactBook: false })).toEqual([true, false]);
  });

  it('聯絡簿模式 → 只有聯絡簿', () => {
    expect(both({ status: 'scheduled', usesContactBook: true })).toEqual([false, true]);
  });

  it('停課 → 兩個都沒有（不會發生的課兩型都沒東西可寫）', () => {
    expect(both({ status: 'cancelled', usesContactBook: false })).toEqual([false, false]);
    expect(both({ status: 'cancelled', usesContactBook: true })).toEqual([false, false]);
  });
});

describe('nextSession（#1314 TS1 首屏「接下來那堂」）', () => {
  const at = (hhmm: string) => new Date(`2026-08-31T${hhmm}:00`);
  const a = session({ sessionId: 'a', startTime: '09:00', endTime: '10:00' });
  const b = session({ sessionId: 'b', startTime: '14:00', endTime: '15:00' });
  const c = session({ sessionId: 'c', startTime: '19:00', endTime: '21:00' });

  it('還沒開始的第一堂就是下一堂', () => {
    expect(nextSession([c, a, b], at('08:00'))?.sessionId).toBe('a');
  });

  it('上課中的那堂還沒上完，所以它就是「接下來」，不是跳到後面那堂', () => {
    expect(nextSession([a, b, c], at('09:30'))?.sessionId).toBe('a');
  });

  it('剛好下課的那一刻算上完了（hasSessionEnded：結束時間 <= 現在）', () => {
    expect(nextSession([a, b, c], at('10:00'))?.sessionId).toBe('b');
  });

  it('全上完了回 null', () => {
    expect(nextSession([a, b, c], at('22:00'))).toBeNull();
  });

  it('停課不算 —— 它不會發生，放首屏是騙人', () => {
    const cancelled = session({ sessionId: 'x', status: 'cancelled', startTime: '08:30' });
    expect(nextSession([cancelled, a], at('08:00'))?.sessionId).toBe('a');
    expect(nextSession([cancelled], at('08:00'))).toBeNull();
  });

  it('沒有課回 null；沒有開始時間的排最後', () => {
    expect(nextSession([], at('08:00'))).toBeNull();
    const noTime = session({ sessionId: 'n', startTime: null, endTime: null });
    expect(sortByStart([noTime, a]).map((s) => s.sessionId)).toEqual(['a', 'n']);
  });

  it('不改傳入的陣列順序', () => {
    const input = [c, a];
    nextSession(input, at('08:00'));
    expect(input.map((s) => s.sessionId)).toEqual(['c', 'a']);
  });
});

describe('openerLine（#1314 TS2 開場句）', () => {
  const at = (hhmm: string) => new Date(`2026-08-31T${hhmm}:00`);
  const a = session({
    sessionId: 'a',
    className: '國三數學',
    startTime: '15:30',
    endTime: '17:00',
  });
  const b = session({
    sessionId: 'b',
    className: '國二英文',
    startTime: '19:00',
    endTime: '20:30',
  });

  it('還沒開始 → 下一堂時間、班名、還有幾分', () => {
    expect(openerLine([b, a], at('15:00'))).toBe('下一堂 15:30 國三數學，還有 30 分。');
  });

  it('不足一分鐘進位，不會寫「還有 0 分」', () => {
    expect(openerLine([a], new Date('2026-08-31T15:29:30'))).toBe(
      '下一堂 15:30 國三數學，還有 1 分。',
    );
  });

  it('上課中 → 寫下課倒數，不是跳到下一堂', () => {
    expect(openerLine([a, b], at('16:00'))).toBe('國三數學 上課中，還有 60 分下課。');
  });

  it('全上完 → 都上完了', () => {
    expect(openerLine([a, b], at('21:00'))).toBe('今天的課都上完了。');
  });

  it('今天只有停課 → 都上完了（停課不會發生）', () => {
    const off = session({ status: 'cancelled', startTime: '15:30', endTime: '17:00' });
    expect(openerLine([off], at('10:00'))).toBe('今天的課都上完了。');
  });

  it('今天沒有課 → 沒有你的課', () => {
    expect(openerLine([], at('10:00'))).toBe('今天沒有你的課。');
  });

  it('沒有時間的課不給倒數，只講班名', () => {
    const n = session({ className: '作文', startTime: null, endTime: null });
    expect(openerLine([n], at('10:00'))).toBe('下一堂 作文。');
  });
});

describe('changeItems（#1314 TS7）', () => {
  const entry = (over: Partial<ChangeLogEntry>): ChangeLogEntry => ({
    id: 'a',
    sessionId: 's',
    changeType: 'cancellation',
    summary: '停課',
    sessionDate: '2026-10-12',
    className: '國三數學',
    reason: null,
    createdByName: null,
    createdAt: '2026-10-10T00:00:00Z',
    isBatch: false,
    batchId: null,
    ...over,
  });

  it('依課堂日期排，不是 created_at；摘要只是類型時不重複', () => {
    const items = changeItems([
      entry({ id: 'late', sessionDate: '2026-10-14' }),
      entry({
        id: 'early',
        sessionDate: '2026-10-12',
        changeType: 'substitute',
        summary: '代課：王 → 李',
      }),
    ]);
    expect(items.map((i) => i.id)).toEqual(['early', 'late']);
    expect(items[0]).toMatchObject({ label: '代課', text: '10/12 國三數學 · 代課：王 → 李' });
    expect(items[1].text).toBe('10/14 國三數學');
  });

  it('沒有課堂日期的列沒地方可跳，丟掉', () => {
    expect(changeItems([entry({ sessionDate: null })])).toEqual([]);
  });
});

/** 台北 2027-03-05 的某個時分秒 → 牆上時鐘（Taipei＝UTC+8，所以 UTC 少 8 小時） */
const at = (hhmmss: string, date = '2027-03-05') => {
  const [h, m, sec = 0] = hhmmss.split(':').map(Number);
  return taipeiWallClock(Date.parse(`${date}T00:00:00Z`) + ((h - 8) * 3600 + m * 60 + sec) * 1000);
};

describe('taipeiWallClock（與瀏覽器時區無關；TZ=UTC／洛杉磯各跑過一次）', () => {
  it('15:59Z 是台北當天 23:59，16:00Z 是隔天 00:00（日界線）', () => {
    const before = taipeiWallClock(Date.parse('2027-03-05T15:59:00Z'));
    expect([before.getFullYear(), before.getMonth(), before.getDate()]).toEqual([2027, 2, 5]);
    expect([before.getHours(), before.getMinutes()]).toEqual([23, 59]);
    const after = taipeiWallClock(Date.parse('2027-03-05T16:00:00Z'));
    expect([after.getFullYear(), after.getMonth(), after.getDate()]).toEqual([2027, 2, 6]);
    expect([after.getHours(), after.getMinutes()]).toEqual([0, 0]);
  });
});

describe('sessionStateText（#1314 TS-B 狀態字）', () => {
  const cls = session({ eventDate: '2027-03-05', startTime: '17:00', endTime: '18:30' });

  it('開始前：還有 N 分開始（分鐘進位，最後半分鐘不寫 0）', () => {
    expect(sessionStateText(cls, at('16:40'))).toBe('還有 20 分開始');
    expect(sessionStateText(cls, at('16:59', '2027-03-05'))).toBe('還有 1 分開始');
    expect(sessionStateText(cls, at('16:59:30'))).toBe('還有 1 分開始');
    expect(sessionStateText(cls, at('16:59:59'))).toBe('還有 1 分開始');
  });

  it('剛好開始那一刻算上課中（門檻 ±1 秒）', () => {
    expect(sessionStateText(cls, at('17:00'))).toBe('上課中 · 還有 90 分下課');
    expect(sessionStateText(cls, at('17:00:01'))).toBe('上課中 · 還有 90 分下課');
  });

  it('上課中：還有 N 分下課；剛好下課那一刻就是已上完（門檻 ±1 秒）', () => {
    expect(sessionStateText(cls, at('18:29'))).toBe('上課中 · 還有 1 分下課');
    expect(sessionStateText(cls, at('18:29:59'))).toBe('上課中 · 還有 1 分下課');
    expect(sessionStateText(cls, at('18:30'))).toBe('已上完');
    expect(sessionStateText(cls, at('18:30:01'))).toBe('已上完');
  });

  it('別天的課沒有倒數：未來「還沒開始」、過去「已上完」', () => {
    expect(sessionStateText({ ...cls, eventDate: '2027-03-06' }, at('12:00'))).toBe('還沒開始');
    expect(sessionStateText({ ...cls, eventDate: '2027-03-04' }, at('12:00'))).toBe('已上完');
  });

  it('停課永遠說已停課（即使已過去；不誣賴成「已上完」）', () => {
    expect(sessionStateText({ ...cls, status: 'cancelled' }, at('12:00'))).toBe('已停課');
    expect(sessionStateText({ ...cls, status: 'cancelled' }, at('20:00'))).toBe('已停課');
  });

  it('沒有起訖時間：當天不說（null），隔天起說已上完', () => {
    const none = { ...cls, startTime: null, endTime: null };
    expect(sessionStateText(none, at('12:00'))).toBeNull();
    expect(sessionStateText({ ...none, eventDate: '2027-03-04' }, at('00:00'))).toBe('已上完');
  });

  it('日界線：台北 23:59 還是當天、00:00 就是隔天（今天的課變成已上完）', () => {
    expect(sessionStateText(cls, at('23:59'))).toBe('已上完');
    expect(sessionStateText({ ...cls, eventDate: '2027-03-06' }, at('23:59'))).toBe('還沒開始');
    expect(sessionStateText({ ...cls, eventDate: '2027-03-06' }, at('00:00', '2027-03-06'))).toBe(
      '還有 1020 分開始',
    );
  });
});

describe('日到班的課（#1314 TS3）', () => {
  const daily = (over: Partial<EventSessionSummary> = {}) =>
    session({ attendanceMode: 'daily_checkin', checkedInCount: 0, ...over });

  it('上完了沒點名也不是「漏點名」—— 日到班沒有逐堂點名', () => {
    const now = new Date('2026-09-01T08:00:00');
    expect(attendanceTone(daily(), now)).toBe('done');
    expect(attendanceTone(session({}), now)).toBe('overdue');
  });

  it('還沒上完 → pending；停課仍是 inactive', () => {
    const now = new Date('2026-08-31T08:00:00');
    expect(attendanceTone(daily(), now)).toBe('pending');
    expect(attendanceTone(daily({ status: 'cancelled' }), now)).toBe('inactive');
  });

  it('橘帶「待點名」與週條的點不算日到班的課', () => {
    const now = new Date('2026-09-01T08:00:00');
    expect(weekAnchor([daily(), session({})], now).overdue).toBe(1);
    expect(daySummary([daily()], now, true).tone).toBe('done');
  });

  it('isDailyCheckin 只看後端給的模式', () => {
    expect(isDailyCheckin(daily())).toBe(true);
    expect(isDailyCheckin(session({}))).toBe(false);
  });

  it('arrivalLine：今天「到 a／n · 還沒到 x · 請假 y」，過去只有到班數，未來只說模式', () => {
    const s = daily({ enrolledCount: 26, checkedInCount: 21, onLeaveCount: 1 });
    expect(arrivalLine(s, '2026-08-31')).toBe('日到班 · 掃碼 到 21／26 · 還沒到 4 · 請假 1');
    expect(arrivalLine(s, '2026-09-01')).toBe('日到班 · 掃碼 到 21／26');
    expect(arrivalLine(s, '2026-08-30')).toBe('日到班 · 掃碼就算到');
    // 沒人請假就不印「請假 0」
    expect(arrivalLine(daily({ enrolledCount: 3, checkedInCount: 1 }), '2026-08-31')).toBe(
      '日到班 · 掃碼 到 1／3 · 還沒到 2',
    );
  });
});
