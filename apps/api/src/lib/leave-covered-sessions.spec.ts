import { describe, expect, it } from 'vitest';

import { coveredSessionsOf, type CoveredSessionCandidate } from './leave-covered-sessions';

const row = (over: Partial<CoveredSessionCandidate>): CoveredSessionCandidate => ({
  leave_id: 'l',
  bound: false,
  session_id: 's',
  status: 'scheduled',
  session_date: '2026-06-04',
  start_time: '12:00:00',
  end_time: '13:00:00',
  class_name: 'A 班',
  effective_from: '2026-01-01',
  effective_to: null,
  ...over,
});
const window = {
  startDate: '2026-06-04',
  endDate: '2026-06-04',
  startTime: '10:00:00',
  endTime: '12:00:00',
  boundSessions: [],
};

describe('coveredSessionsOf（#1314 LV2）', () => {
  it('假到 12:00、課 12:00 開始：接續不是重疊，不列（時間同為 HH:MM:SS 才比得對）', () => {
    expect(coveredSessionsOf(window, [row({})])).toEqual([]);
  });

  it('重疊的列出來、回 HH:MM；停課、那天不在籍、重複的都不列', () => {
    const got = coveredSessionsOf(window, [
      row({ session_id: 'a', start_time: '11:00:00', end_time: '12:00:00' }),
      row({ session_id: 'a', start_time: '11:00:00', end_time: '12:00:00' }),
      row({ session_id: 'x', start_time: '11:00:00', status: 'cancelled' }),
      row({ session_id: 'y', start_time: '11:00:00', effective_to: '2026-06-03' }),
    ]);
    expect(got).toEqual([
      { id: 'a', date: '2026-06-04', startTime: '11:00', endTime: '12:00', className: 'A 班' },
    ]);
  });
});
