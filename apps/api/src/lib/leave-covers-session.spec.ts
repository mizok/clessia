import { describe, expect, it } from 'vitest';

import { leaveCoversSession } from './leave-covers-session';

const wholeDay = { startDate: '2026-04-06', endDate: '2026-04-06', startTime: null, endTime: null };
const morningSession = { date: '2026-04-06', startTime: '09:00', endTime: '11:00' };

describe('leaveCoversSession', () => {
  it('全天假蓋掉當天所有課堂', () => {
    expect(leaveCoversSession(wholeDay, morningSession)).toBe(true);
  });

  it('不同天的假蓋不到', () => {
    expect(leaveCoversSession(wholeDay, { ...morningSession, date: '2026-04-07' })).toBe(false);
    expect(leaveCoversSession(wholeDay, { ...morningSession, date: '2026-04-05' })).toBe(false);
  });

  it('跨日的假蓋到中間每一天', () => {
    const span = { startDate: '2026-04-06', endDate: '2026-04-08', startTime: null, endTime: null };
    expect(leaveCoversSession(span, { ...morningSession, date: '2026-04-07' })).toBe(true);
    expect(leaveCoversSession(span, { ...morningSession, date: '2026-04-09' })).toBe(false);
  });

  it('單日的半天假只蓋到重疊的那幾堂', () => {
    const afternoon = {
      startDate: '2026-04-06',
      endDate: '2026-04-06',
      startTime: '13:00',
      endTime: '17:00',
    };

    expect(leaveCoversSession(afternoon, morningSession)).toBe(false);
    expect(
      leaveCoversSession(afternoon, { date: '2026-04-06', startTime: '14:00', endTime: '16:00' }),
    ).toBe(true);
    // 部分重疊也算 —— 課上到一半才走，那堂仍然受影響
    expect(
      leaveCoversSession(afternoon, { date: '2026-04-06', startTime: '12:00', endTime: '14:00' }),
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
      leaveCoversSession(morning, { date: '2026-04-06', startTime: '12:00', endTime: '14:00' }),
    ).toBe(false);
  });

  it('跨日的假即使帶了時間也當整天 —— 時間套在哪一天沒有定義', () => {
    const span = {
      startDate: '2026-04-06',
      endDate: '2026-04-08',
      startTime: '13:00',
      endTime: '17:00',
    };

    expect(leaveCoversSession(span, morningSession)).toBe(true);
  });

  it('課堂沒有時間就當整天', () => {
    const afternoon = {
      startDate: '2026-04-06',
      endDate: '2026-04-06',
      startTime: '13:00',
      endTime: '17:00',
    };

    expect(
      leaveCoversSession(afternoon, { date: '2026-04-06', startTime: null, endTime: null }),
    ).toBe(true);
  });
});
