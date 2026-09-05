import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import attendanceRoute from './attendance';

/**
 * 只實作這支 route 用得到的鏈：`.eq().gte()...` 一路回自己，await 時
 * 依表名決定回傳內容。這組測試不重測 attendance-query.ts 的映射邏輯
 * （那有自己的單元測試），只釘住這支 route 特有的東西：角色擋、
 * 越權指名擋、`.eq('student_id', childId)` 有沒有疊上去、月度統計走了
 * 獨立查詢。
 */
function chainable(
  resolve: (calls: Record<string, unknown>) => { data: unknown; error: unknown; count?: number },
) {
  const calls: Record<string, unknown> = {};
  const obj: any = {
    eq: (col: string, value: unknown) => {
      calls[`eq:${col}`] = value;
      return obj;
    },
    gte: (col: string, value: unknown) => {
      calls[`gte:${col}`] = value;
      return obj;
    },
    lte: (col: string, value: unknown) => {
      calls[`lte:${col}`] = value;
      return obj;
    },
    in: (col: string, value: unknown) => {
      calls[`in:${col}`] = value;
      return obj;
    },
    range: () => obj,
    order: () => obj,
    then: (onfulfilled: (value: unknown) => unknown) =>
      Promise.resolve(resolve(calls)).then(onfulfilled),
  };
  return obj;
}

function fakeChildDb(rows: unknown[], monthlyCounts: { absent: number; onLeave: number }) {
  return {
    from: (table: string) => ({
      select: (_cols: string, opts?: { head?: boolean }) => {
        if (opts?.head) {
          // 缺席與請假現在是兩支獨立查詢 —— 依 `.eq('status', ...)` 分流，
          // 不然這個假 DB 會讓兩支查詢回同一個數字，測不出「真的分開回」。
          return chainable((calls) => {
            const status = calls['eq:status'];
            const count =
              status === 'absent'
                ? monthlyCounts.absent
                : status === 'on_leave'
                  ? monthlyCounts.onLeave
                  : 0;
            return { data: null, error: null, count };
          });
        }
        return chainable(() => ({ data: rows, error: null, count: rows.length }));
      },
    }),
  };
}

function appWith(roles: string[], studentScope: readonly string[] | null, childDb: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', roles);
    set('studentScope', studentScope);
    set('childDb', childDb);
    await next();
  });
  app.route('/', attendanceRoute as unknown as Hono);
  return app;
}

const ROW = {
  id: 'a1',
  org_id: 'org-1',
  student_id: '00000000-0000-0000-0000-000000000001',
  event_id: 'e1',
  status: 'absent',
  note: '請假原因',
  recorded_by: 'staff-user-id',
  recorded_by_role: 'teacher',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  students: { name: '王小明' },
  events: {
    event_date: '2026-09-01',
    start_time: '09:00',
    end_time: '10:00',
    campuses: { name: '本校' },
    sessions: [{ classes: { name: '數學 A' } }],
  },
};

describe('GET /api/me/attendance', () => {
  it('不是家長身分回 403', async () => {
    const res = await appWith(
      ['teacher'],
      ['00000000-0000-0000-0000-000000000001'],
      fakeChildDb([], { absent: 0, onLeave: 0 }),
    ).request('/?childId=00000000-0000-0000-0000-000000000001');
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'NOT_PARENT' });
  });

  it('childId 不在 studentScope 裡回 403，不是空清單', async () => {
    const res = await appWith(
      ['parent'],
      ['00000000-0000-0000-0000-000000000002'],
      fakeChildDb([ROW], { absent: 1, onLeave: 0 }),
    ).request('/?childId=00000000-0000-0000-0000-000000000001');
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'CHILD_OUT_OF_SCOPE' });
  });

  it('是家長且孩子在範圍內時回列表，recordedBy/recordedByRole 不外流', async () => {
    const res = await appWith(
      ['parent'],
      ['00000000-0000-0000-0000-000000000001'],
      fakeChildDb([ROW], { absent: 3, onLeave: 2 }),
    ).request('/?childId=00000000-0000-0000-0000-000000000001');

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };

    expect(body.data).toHaveLength(1);
    expect(body.data[0]).not.toHaveProperty('recordedBy');
    expect(body.data[0]).not.toHaveProperty('recordedByRole');
    expect(body.data[0]).toMatchObject({
      id: 'a1',
      status: 'absent',
      className: '數學 A',
      note: '請假原因',
    });
    // 月度統計走獨立查詢，不是從當頁筆數算出來的；缺席與請假分開回
    // （不合計），兩個數字刻意不同，證明真的是兩支查詢而不是同一個數字複製兩份
    expect(body.meta).toMatchObject({ monthlyAbsentCount: 3, monthlyOnLeaveCount: 2 });
  });
});
