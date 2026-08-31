import { hasSessionEnded, todayLocal, type SessionTimeLike } from './session-time.util';

function session(overrides: Partial<SessionTimeLike> = {}): SessionTimeLike {
  return { date: '2026-08-30', startTime: '09:00', endTime: '11:00', ...overrides };
}

/** 2026-08-30 中午 */
const NOON = new Date('2026-08-30T12:00:00');

describe('hasSessionEnded', () => {
  it('今天早上上完的課算結束', () => {
    expect(hasSessionEnded(session(), NOON)).toBe(true);
  });

  // 這是這個函式存在的理由：晚上的課從一早就被標成「漏點名」是誤報
  it('今天晚上還沒上的課不算結束', () => {
    expect(hasSessionEnded(session({ startTime: '19:00', endTime: '21:00' }), NOON)).toBe(false);
  });

  it('剛好結束在此刻算結束', () => {
    expect(hasSessionEnded(session({ startTime: '10:00', endTime: '12:00' }), NOON)).toBe(true);
  });

  it('昨天的課算結束', () => {
    expect(hasSessionEnded(session({ date: '2026-08-29', endTime: '21:00' }), NOON)).toBe(true);
  });

  it('明天的課不算結束', () => {
    expect(hasSessionEnded(session({ date: '2026-08-31', endTime: '09:00' }), NOON)).toBe(false);
  });

  describe('沒有結束時間', () => {
    // 無從判斷今天那堂上完了沒 —— 寧可漏標也不要誤標，假警示會讓人不再相信這個標記
    it('今天的課在當天內不算結束', () => {
      expect(hasSessionEnded(session({ endTime: null }), NOON)).toBe(false);
    });

    it('今天的課在當天結束前都不算結束', () => {
      const almostMidnight = new Date('2026-08-30T23:59:00');

      expect(hasSessionEnded(session({ endTime: null }), almostMidnight)).toBe(false);
    });

    // 但這一天過完之後就一定上完了 —— 永遠回 false 會讓沒填時間的課永遠不被追
    it('隔天就算結束', () => {
      const nextDay = new Date('2026-08-31T00:00:00');

      expect(hasSessionEnded(session({ endTime: null }), nextDay)).toBe(true);
    });

    it('startTime 也沒有時同樣按整天算', () => {
      expect(hasSessionEnded(session({ startTime: null, endTime: null }), NOON)).toBe(false);
    });
  });

  describe('跨午夜的課', () => {
    // endTime < startTime 表示結束在隔天，不然 23:00-01:00 的課會被當成「早上一點就結束了」
    it('23:00–01:00 的課在當天午夜前不算結束', () => {
      const beforeMidnight = new Date('2026-08-30T23:30:00');

      expect(
        hasSessionEnded(session({ startTime: '23:00', endTime: '01:00' }), beforeMidnight),
      ).toBe(false);
    });

    it('23:00–01:00 的課在隔天凌晨兩點算結束', () => {
      const nextMorning = new Date('2026-08-31T02:00:00');

      expect(hasSessionEnded(session({ startTime: '23:00', endTime: '01:00' }), nextMorning)).toBe(
        true,
      );
    });
  });

  // 兩個 domain 的欄位名不同（EventSessionSummary.eventDate / Session.sessionDate），
  // 所以這個函式吃的是最小結構介面，呼叫端各自適配
  it('只吃 date/startTime/endTime，不綁任何一個 domain 型別', () => {
    const fromAttendance = { date: '2026-08-30', startTime: '09:00', endTime: '11:00' };
    const fromSessions = { date: '2026-08-30', startTime: '09:00', endTime: '11:00' };

    expect(hasSessionEnded(fromAttendance, NOON)).toBe(hasSessionEnded(fromSessions, NOON));
  });
});

describe('todayLocal', () => {
  // `new Date(y, m, d, …)` 建的是**本地**時間，所以這條斷言與機器時區無關
  it('回傳本地日期，不是 UTC 日期', () => {
    // 本地 2026-08-31 00:30 —— 在 UTC+8 這一刻的 UTC 日期是 08-30
    expect(todayLocal(new Date(2026, 7, 31, 0, 30))).toBe('2026-08-31');
  });

  it('月與日補零', () => {
    expect(todayLocal(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });

  it('一天的最後一刻仍是同一天', () => {
    expect(todayLocal(new Date(2026, 7, 31, 23, 59, 59))).toBe('2026-08-31');
  });

  it('跨年', () => {
    expect(todayLocal(new Date(2027, 0, 1, 0, 0))).toBe('2027-01-01');
  });

  /**
   * 這一條是**防止改回 `toISOString()`** 的主要防線。
   *
   * 它在 UTC 機器上抓不到迴歸（那裡本地就是 UTC），但在任何有偏移的時區都會紅 ——
   * 而開發與 CI 都不在 UTC。真正的防線其實是這個函式的名字：
   * 有 `todayLocal` 可用時，沒有人會刻意去寫 `toISOString().slice(0, 10)`。
   */
  it('與 toISOString 在跨 UTC 邊界的時刻不同（只在有時區偏移時有意義）', () => {
    const localMidnightish = new Date(2026, 7, 31, 0, 30);
    const utcDate = localMidnightish.toISOString().slice(0, 10);

    if (localMidnightish.getTimezoneOffset() < 0) {
      // 東半球（UTC+N）：UTC 日期會落後一天
      expect(utcDate).not.toBe(todayLocal(localMidnightish));
    } else {
      // UTC 或西半球：這一刻兩者可能相同，這條就沒有鑑別力
      expect(todayLocal(localMidnightish)).toBe('2026-08-31');
    }
  });
});
