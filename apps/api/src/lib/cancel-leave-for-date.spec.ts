import { describe, expect, it } from 'vitest';

import { cancelLeaveForDate } from './cancel-leave-for-date';

const cancel = (startDate: string, endDate: string, date: string) =>
  cancelLeaveForDate({ startDate, endDate }, date);

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
