import { describe, expect, it } from 'vitest';

import { applyAttendanceTakenFilter, eventsJoinModifier } from './attendance-session-events';

/**
 * 這兩支是 `/api/attendance/sessions` 與 `/api/sessions` 的 `attendanceTaken`
 * 共用的判定 —— 測一次就是測兩支，不會出現「同一個概念兩支端點各算一次然後漂移」。
 */
describe('eventsJoinModifier', () => {
  it('要下 attendanceTaken 條件時换成 !inner', () => {
    expect(eventsJoinModifier(true)).toBe('!event_id!inner');
  });

  it('不下條件時維持原本的 left join', () => {
    expect(eventsJoinModifier(false)).toBe('!event_id');
  });
});

describe('applyAttendanceTakenFilter', () => {
  function fakeQuery() {
    const calls: { is?: [string, unknown]; not?: [string, string, unknown] } = {};
    const query: any = {
      is: (col: string, value: unknown) => {
        calls.is = [col, value];
        return query;
      },
      not: (col: string, op: string, value: unknown) => {
        calls.not = [col, op, value];
        return query;
      },
    };
    return { calls, query };
  }

  it('false：查得到 event 但還沒點名', () => {
    const { calls, query } = fakeQuery();
    applyAttendanceTakenFilter(query, false);
    expect(calls.is).toEqual(['events.attendance_taken_at', null]);
    expect(calls.not).toBeUndefined();
  });

  it('true：查得到 event 而且點過了', () => {
    const { calls, query } = fakeQuery();
    applyAttendanceTakenFilter(query, true);
    expect(calls.not).toEqual(['events.attendance_taken_at', 'is', null]);
    expect(calls.is).toBeUndefined();
  });

  it('undefined：不下任何條件（原樣回傳同一個 query）', () => {
    const { calls, query } = fakeQuery();
    const result = applyAttendanceTakenFilter(query, undefined);
    expect(result).toBe(query);
    expect(calls.is).toBeUndefined();
    expect(calls.not).toBeUndefined();
  });
});
