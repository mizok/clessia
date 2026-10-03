import { describe, expect, it } from 'vitest';

import {
  leaveCoversSession,
  leavesConflict,
  toLeaveWindow,
  type LeaveWindow,
  type SessionWindow,
} from './leave-covers-session';

/** 舊語意的案例不關心綁定：沒綁定、課堂不指名 */
const covers = (
  leave: Omit<LeaveWindow, 'boundSessions'>,
  session: Omit<SessionWindow, 'sessionId'>,
) => leaveCoversSession({ ...leave, boundSessions: [] }, { ...session, sessionId: null });

const wholeDay = { startDate: '2026-04-06', endDate: '2026-04-06', startTime: null, endTime: null };
const morningSession = { date: '2026-04-06', startTime: '09:00', endTime: '11:00' };

describe('leaveCoversSession', () => {
  it('全天假蓋掉當天所有課堂', () => {
    expect(covers(wholeDay, morningSession)).toBe(true);
  });

  it('不同天的假蓋不到', () => {
    expect(covers(wholeDay, { ...morningSession, date: '2026-04-07' })).toBe(false);
    expect(covers(wholeDay, { ...morningSession, date: '2026-04-05' })).toBe(false);
  });

  it('跨日的假蓋到中間每一天', () => {
    const span = { startDate: '2026-04-06', endDate: '2026-04-08', startTime: null, endTime: null };
    expect(covers(span, { ...morningSession, date: '2026-04-07' })).toBe(true);
    expect(covers(span, { ...morningSession, date: '2026-04-09' })).toBe(false);
  });

  it('單日的半天假只蓋到重疊的那幾堂', () => {
    const afternoon = {
      startDate: '2026-04-06',
      endDate: '2026-04-06',
      startTime: '13:00',
      endTime: '17:00',
    };

    expect(covers(afternoon, morningSession)).toBe(false);
    expect(
      covers(afternoon, { date: '2026-04-06', startTime: '14:00', endTime: '16:00' }),
    ).toBe(true);
    // 部分重疊也算 —— 課上到一半才走，那堂仍然受影響
    expect(
      covers(afternoon, { date: '2026-04-06', startTime: '12:00', endTime: '14:00' }),
    ).toBe(true);
  });

  it('接續不算重疊 —— 請假到 12:00、課堂 12:00 開始', () => {
    const morning = {
      startDate: '2026-04-06',
      endDate: '2026-04-06',
      startTime: '09:00',
      endTime: '12:00',
    };

    expect(
      covers(morning, { date: '2026-04-06', startTime: '12:00', endTime: '14:00' }),
    ).toBe(false);
  });

  it('跨日的假即使帶了時間也當整天 —— 時間套在哪一天沒有定義', () => {
    const span = {
      startDate: '2026-04-06',
      endDate: '2026-04-08',
      startTime: '13:00',
      endTime: '17:00',
    };

    expect(covers(span, morningSession)).toBe(true);
  });

  it('課堂沒有時間就當整天', () => {
    const afternoon = {
      startDate: '2026-04-06',
      endDate: '2026-04-06',
      startTime: '13:00',
      endTime: '17:00',
    };

    expect(
      covers(afternoon, { date: '2026-04-06', startTime: null, endTime: null }),
    ).toBe(true);
  });
});

describe('leaveCoversSession —— 綁定堂次（#1114）', () => {
  const bound: LeaveWindow = {
    startDate: '2026-04-06',
    endDate: '2026-04-08',
    startTime: null,
    endTime: null,
    boundSessions: [
      { sessionId: 's-mon-am', date: '2026-04-06' },
      { sessionId: 's-wed-pm', date: '2026-04-08' },
    ],
  };
  const at = (sessionId: string | null, date: string): SessionWindow => ({
    sessionId,
    date,
    startTime: '09:00',
    endTime: '11:00',
  });

  it('有綁定：只蓋綁定的堂，同日其他堂不蓋', () => {
    expect(leaveCoversSession(bound, at('s-mon-am', '2026-04-06'))).toBe(true);
    expect(leaveCoversSession(bound, at('s-mon-pm', '2026-04-06'))).toBe(false);
  });

  it('有綁定：區間中間沒綁的日子不蓋（不看日期區間）', () => {
    expect(leaveCoversSession(bound, at('s-tue', '2026-04-07'))).toBe(false);
  });

  it('日層級查詢（不指名堂）：當天有任一綁定堂就算蓋到', () => {
    expect(leaveCoversSession(bound, at(null, '2026-04-06'))).toBe(true);
    expect(leaveCoversSession(bound, at(null, '2026-04-07'))).toBe(false);
  });
});

describe('toLeaveWindow', () => {
  it('把 embed 的綁定列攤平成 boundSessions；沒有 embed 時是空陣列', () => {
    expect(
      toLeaveWindow({
        start_date: '2026-04-06',
        end_date: '2026-04-06',
        start_time: '13:00:00',
        end_time: null,
        leave_request_sessions: [{ session_id: 's1', sessions: { session_date: '2026-04-06' } }],
      }),
    ).toEqual({
      startDate: '2026-04-06',
      endDate: '2026-04-06',
      startTime: '13:00:00',
      endTime: null,
      boundSessions: [{ sessionId: 's1', date: '2026-04-06' }],
    });
    expect(
      toLeaveWindow({ start_date: 'a', end_date: 'b', start_time: null, end_time: null })
        .boundSessions,
    ).toEqual([]);
  });
});

describe('leavesConflict（#1114 裁定 4）', () => {
  const whole = (startDate: string, endDate: string): LeaveWindow => ({
    startDate,
    endDate,
    startTime: null,
    endTime: null,
    boundSessions: [],
  });
  const bound = (...s: Array<[string, string]>): LeaveWindow => ({
    ...whole(s[0]![1], s[s.length - 1]![1]),
    boundSessions: s.map(([sessionId, date]) => ({ sessionId, date })),
  });

  it('都綁定：只有共用同一堂才衝突', () => {
    expect(leavesConflict(bound(['am', '2026-04-06']), bound(['pm', '2026-04-06']))).toBe(false);
    expect(leavesConflict(bound(['am', '2026-04-06']), bound(['am', '2026-04-06']))).toBe(true);
  });

  it('一綁一整天：綁定堂落在整天型區間就衝突，兩個方向一樣', () => {
    const b = bound(['am', '2026-04-06'], ['x', '2026-04-08']);
    expect(leavesConflict(b, whole('2026-04-08', '2026-04-08'))).toBe(true);
    expect(leavesConflict(whole('2026-04-07', '2026-04-07'), b)).toBe(false);
  });

  it('都沒綁定：端點日相同也算重疊', () => {
    expect(leavesConflict(whole('2026-04-04', '2026-04-06'), whole('2026-04-06', '2026-04-08'))).toBe(
      true,
    );
    expect(leavesConflict(whole('2026-04-04', '2026-04-05'), whole('2026-04-06', '2026-04-08'))).toBe(
      false,
    );
  });
});
