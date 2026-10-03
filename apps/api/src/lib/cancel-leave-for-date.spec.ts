import { describe, expect, it } from 'vitest';

import { cancelLeaveForDate } from './cancel-leave-for-date';

const cancel = (startDate: string, endDate: string, date: string) =>
  cancelLeaveForDate({ startDate, endDate, boundSessions: [] }, date);

describe('cancelLeaveForDate', () => {
  it('整張假就是那一天 → 刪掉整張', () => {
    expect(cancel('2026-04-06', '2026-04-06', '2026-04-06')).toEqual({ kind: 'delete' });
  });

  it('今天開始、之後才結束 → 從明天開始（明天的假還算數）', () => {
    expect(cancel('2026-04-06', '2026-04-08', '2026-04-06')).toEqual({
      kind: 'shrink',
      startDate: '2026-04-07',
      endDate: '2026-04-08',
      droppedAfter: null,
    });
  });

  it('之前開始、今天結束 → 截到昨天', () => {
    expect(cancel('2026-04-04', '2026-04-06', '2026-04-06')).toEqual({
      kind: 'shrink',
      startDate: '2026-04-04',
      endDate: '2026-04-05',
      droppedAfter: null,
    });
  });

  it('今天卡在中間 → 截到昨天，並回報後面被連坐的截止日', () => {
    expect(cancel('2026-04-04', '2026-04-08', '2026-04-06')).toEqual({
      kind: 'shrink',
      startDate: '2026-04-04',
      endDate: '2026-04-05',
      // 老師要被告知「04-07、04-08 的假也一起取消了」
      droppedAfter: '2026-04-08',
    });
  });

  it('跨月也要算對', () => {
    expect(cancel('2026-04-29', '2026-05-02', '2026-04-30')).toEqual({
      kind: 'shrink',
      startDate: '2026-04-29',
      endDate: '2026-04-29',
      droppedAfter: '2026-05-02',
    });
    expect(cancel('2026-04-30', '2026-05-02', '2026-04-30')).toMatchObject({
      startDate: '2026-05-01',
    });
  });

  it('這一天根本沒被蓋到 → 不動它', () => {
    expect(cancel('2026-04-04', '2026-04-05', '2026-04-06')).toEqual({ kind: 'none' });
    expect(cancel('2026-04-07', '2026-04-08', '2026-04-06')).toEqual({ kind: 'none' });
  });
});

describe('cancelLeaveForDate —— 綁定堂次（#1114 裁定 1）', () => {
  const leave = {
    startDate: '2026-04-06',
    endDate: '2026-04-08',
    boundSessions: [
      { sessionId: 'mon-am', date: '2026-04-06' },
      { sessionId: 'mon-pm', date: '2026-04-06' },
      { sessionId: 'wed', date: '2026-04-08' },
    ],
  };

  it('只移除當天的綁定列，區間收成剩下綁定堂的最早／最晚，不連坐後面的日子', () => {
    expect(cancelLeaveForDate(leave, '2026-04-06')).toEqual({
      kind: 'unbind',
      sessionIds: ['mon-am', 'mon-pm'],
      startDate: '2026-04-08',
      endDate: '2026-04-08',
    });
  });

  it('當天沒有綁定堂（區間中間的空日）→ none', () => {
    expect(cancelLeaveForDate(leave, '2026-04-07')).toEqual({ kind: 'none' });
  });

  it('綁定堂全在當天 → 刪整張', () => {
    expect(
      cancelLeaveForDate(
        { ...leave, boundSessions: [{ sessionId: 'mon-am', date: '2026-04-06' }] },
        '2026-04-06',
      ),
    ).toEqual({ kind: 'delete' });
  });
});
