import { describe, expect, it } from 'vitest';

import { buildSubstitutedAwayEntries, type SubstitutedAwayRow } from './substituted-away';

function row(overrides: Partial<SubstitutedAwayRow> & { reason?: string | null } = {}) {
  return {
    id: 'chg-1',
    session_id: 'sess-1',
    created_at: '2026-08-10T03:00:00Z',
    original_teacher_id: 't1',
    reason: null,
    sessions: {
      session_date: '2026-08-12',
      start_time: '19:00:00',
      end_time: '21:00:00',
      classes: { name: '國二數學 A' },
    },
    staff: { id: 't2', display_name: '李老師' },
    ...overrides,
  } as SubstitutedAwayRow;
}

describe('buildSubstitutedAwayEntries', () => {
  it('組出課堂日期、時間、班級與代課老師', () => {
    const [entry] = buildSubstitutedAwayEntries([row()]);

    expect(entry).toEqual({
      changeId: 'chg-1',
      sessionId: 'sess-1',
      sessionDate: '2026-08-12',
      startTime: '19:00',
      endTime: '21:00',
      className: '國二數學 A',
      substituteTeacherName: '李老師',
      reason: null,
      changedAt: '2026-08-10T03:00:00Z',
    });
  });

  it('時間去掉秒數', () => {
    const [entry] = buildSubstitutedAwayEntries([row()]);

    expect(entry.startTime).toBe('19:00');
    expect(entry.endTime).toBe('21:00');
  });

  it('PostgREST 把關聯回成陣列時也要取得到值', () => {
    const [entry] = buildSubstitutedAwayEntries([
      row({
        sessions: [
          { session_date: '2026-08-12', start_time: '19:00:00', end_time: '21:00:00', classes: [{ name: '國三英文' }] },
        ],
        staff: [{ id: 't2', display_name: '陳老師' }],
      }),
    ]);

    expect(entry.className).toBe('國三英文');
    expect(entry.substituteTeacherName).toBe('陳老師');
  });

  it('依課堂日期由新到舊排序，而不是異動登記時間', () => {
    // 異動可能是同一天一次補登的，用 created_at 排會失去意義
    const entries = buildSubstitutedAwayEntries([
      row({ id: 'a', created_at: '2026-08-10T01:00:00Z', sessions: { session_date: '2026-08-05', start_time: '19:00:00', end_time: '21:00:00', classes: { name: 'X' } } }),
      row({ id: 'b', created_at: '2026-08-10T02:00:00Z', sessions: { session_date: '2026-08-20', start_time: '19:00:00', end_time: '21:00:00', classes: { name: 'X' } } }),
      row({ id: 'c', created_at: '2026-08-10T03:00:00Z', sessions: { session_date: '2026-08-12', start_time: '19:00:00', end_time: '21:00:00', classes: { name: 'X' } } }),
    ]);

    expect(entries.map((e) => e.changeId)).toEqual(['b', 'c', 'a']);
  });

  it('同一天多堂時依開始時間由晚到早', () => {
    const entries = buildSubstitutedAwayEntries([
      row({ id: 'morning', sessions: { session_date: '2026-08-12', start_time: '09:00:00', end_time: '11:00:00', classes: { name: 'X' } } }),
      row({ id: 'evening', sessions: { session_date: '2026-08-12', start_time: '19:00:00', end_time: '21:00:00', classes: { name: 'X' } } }),
    ]);

    expect(entries.map((e) => e.changeId)).toEqual(['evening', 'morning']);
  });

  it('缺少課堂日期的異常資料排到最後，不會擠在最前面', () => {
    const entries = buildSubstitutedAwayEntries([
      row({ id: 'broken', sessions: null }),
      row({ id: 'ok' }),
    ]);

    expect(entries.map((e) => e.changeId)).toEqual(['ok', 'broken']);
    expect(entries[1].sessionDate).toBeNull();
  });

  it('空清單回傳空陣列', () => {
    expect(buildSubstitutedAwayEntries([])).toEqual([]);
  });
});
