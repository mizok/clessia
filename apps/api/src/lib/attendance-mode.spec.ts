import { describe, expect, it } from 'vitest';

import { pickAttendanceMode, resolveAttendanceMode } from './attendance-mode';

/**
 * #1112：出勤模式是**分校層級**（flows/attendance.md 2、specs/admin/system/campuses.md）。
 * 推算：分校有值用分校的，沒有（null）沿用機構預設；機構也讀不到時跟 DB 預設一致（#976）。
 */
describe('pickAttendanceMode', () => {
  it('分校有值就用分校的，不看機構', () => {
    expect(pickAttendanceMode('per_session', 'daily_checkin')).toBe('per_session');
    expect(pickAttendanceMode('daily_checkin', 'per_session')).toBe('daily_checkin');
  });

  it('分校沒設定（null）沿用機構預設', () => {
    expect(pickAttendanceMode(null, 'per_session')).toBe('per_session');
  });

  it('兩邊都讀不到時是日到班（DB 預設）', () => {
    expect(pickAttendanceMode(null, null)).toBe('daily_checkin');
  });
});

describe('resolveAttendanceMode', () => {
  function fakeDb(rows: { org?: unknown; campus?: unknown; orgError?: boolean }) {
    const eqCalls: Array<{ table: string; column: string; value: unknown }> = [];
    const client = {
      from(table: string) {
        const query = {
          select: () => query,
          eq: (column: string, value: unknown) => {
            eqCalls.push({ table, column, value });
            return query;
          },
          maybeSingle: () =>
            Promise.resolve(
              table === 'organizations'
                ? rows.orgError
                  ? { data: null, error: { message: 'boom' } }
                  : { data: rows.org ?? null, error: null }
                : { data: rows.campus ?? null, error: null },
            ),
        };
        return query;
      },
    };
    return { client: client as never, eqCalls };
  }

  it('帶分校：分校值蓋過機構預設', async () => {
    const { client } = fakeDb({
      org: { attendance_mode: 'daily_checkin' },
      campus: { attendance_mode: 'per_session' },
    });
    expect(await resolveAttendanceMode(client, 'org-1', 'campus-1')).toEqual({
      mode: 'per_session',
      error: null,
    });
  });

  // 別 org 的分校 id 不能借到它的設定（c1）
  it('分校查詢帶 org 條件', async () => {
    const { client, eqCalls } = fakeDb({ org: { attendance_mode: 'daily_checkin' } });
    await resolveAttendanceMode(client, 'org-1', 'campus-1');
    expect(eqCalls).toContainEqual({ table: 'campuses', column: 'org_id', value: 'org-1' });
  });

  it('不帶分校：不查分校表，用機構預設', async () => {
    const { client, eqCalls } = fakeDb({ org: { attendance_mode: 'per_session' } });
    expect(await resolveAttendanceMode(client, 'org-1', null)).toEqual({
      mode: 'per_session',
      error: null,
    });
    expect(eqCalls.some((call) => call.table === 'campuses')).toBe(false);
  });

  it('讀機構失敗：回 error，不猜模式', async () => {
    const { client } = fakeDb({ orgError: true });
    const result = await resolveAttendanceMode(client, 'org-1', 'campus-1');
    expect(result.mode).toBeNull();
    expect(result.error).toEqual({ message: 'boom' });
  });
});
