import { Hono } from 'hono';
import { describe, it, expect } from 'vitest';

import leavesApp from './leaves';
import {
  buildLeaveAttendanceAuditDetails,
  buildLeaveAuditResourceName,
  buildLeaveAttendanceUpserts,
  getLeaveValidationError,
  toLeaveResponse,
} from './leaves';

describe('toLeaveResponse', () => {
  it('maps DB row to camelCase response', () => {
    const row = {
      id: 'lr-1',
      org_id: 'org-1',
      student_id: 'stu-1',
      student_name: '王小明',
      start_date: '2026-04-01',
      end_date: '2026-04-01',
      reason: '身體不適',
      submitted_by: 'user-1',
      submitted_by_role: 'admin',
      submitted_by_name: '張老師',
      created_at: '2026-04-01T00:00:00Z',
    };
    const result = toLeaveResponse(row);
    expect(result.id).toBe('lr-1');
    expect(result.studentName).toBe('王小明');
    expect(result.submittedByRole).toBe('admin');
  });
});

describe('getLeaveValidationError', () => {
  it('rejects reversed date range', () => {
    expect(
      getLeaveValidationError({
        startDate: '2026-04-05',
        endDate: '2026-04-04',
        startTime: null,
        endTime: null,
      }),
    ).toBe('結束日期不可早於開始日期');
  });

  it('rejects same-day reversed time range', () => {
    expect(
      getLeaveValidationError({
        startDate: '2026-04-05',
        endDate: '2026-04-05',
        startTime: '15:00',
        endTime: '09:00',
      }),
    ).toBe('同一天請假的結束時間不可早於開始時間');
  });

  it('allows multi-day leave with independent start and end times', () => {
    expect(
      getLeaveValidationError({
        startDate: '2026-04-05',
        endDate: '2026-04-06',
        startTime: '15:00',
        endTime: '09:00',
      }),
    ).toBeNull();
  });
});

describe('buildLeaveAttendanceUpserts', () => {
  it('only marks events covered by active enrollments on that event date', () => {
    const rows = buildLeaveAttendanceUpserts({
      orgId: 'org-1',
      studentId: 'student-1',
      recordedBy: 'user-1',
      events: [
        {
          id: 'event-1',
          event_date: '2026-04-02',
          sessions: { class_id: 'class-1' },
        },
        {
          id: 'event-2',
          event_date: '2026-04-02',
          sessions: { class_id: 'class-2' },
        },
        {
          id: 'event-3',
          event_date: '2026-04-10',
          sessions: { class_id: 'class-1' },
        },
      ],
      enrollments: [
        {
          class_id: 'class-1',
          effective_from: '2026-04-01',
          effective_to: '2026-04-05',
        },
      ],
    });

    expect(rows).toEqual([
      {
        org_id: 'org-1',
        student_id: 'student-1',
        event_id: 'event-1',
        status: 'on_leave',
        recorded_by: 'user-1',
        recorded_by_role: 'system',
      },
    ]);
  });

  it('supports Supabase nested session rows returned as an array', () => {
    const rows = buildLeaveAttendanceUpserts({
      orgId: 'org-1',
      studentId: 'student-1',
      recordedBy: 'user-1',
      events: [
        {
          id: 'event-1',
          event_date: '2026-04-02',
          sessions: [{ class_id: 'class-1' }],
        } as any,
      ],
      enrollments: [
        {
          class_id: 'class-1',
          effective_from: '2026-04-01',
          effective_to: null,
        },
      ],
    });

    expect(rows).toEqual([
      {
        org_id: 'org-1',
        student_id: 'student-1',
        event_id: 'event-1',
        status: 'on_leave',
        recorded_by: 'user-1',
        recorded_by_role: 'system',
      },
    ]);
  });
});

describe('leave audit helpers', () => {
  it('formats leave audit resource name with student and date range', () => {
    expect(
      buildLeaveAuditResourceName({
        studentName: '劉靖雯',
        startDate: '2026-04-02',
        endDate: '2026-04-30',
      }),
    ).toBe('劉靖雯 / 2026-04-02 ~ 2026-04-30');
  });

  it('summarizes leave-driven attendance changes', () => {
    expect(buildLeaveAttendanceAuditDetails(4)).toEqual({ affectedEventCount: 4 });
  });
});

/**
 * 刪除請假時，那幾天的出勤紀錄怎麼處理。
 *
 * **原本是把 `on_leave` 改成 `absent`** —— 管理員刪掉一張假，那幾天的學生就全被記成
 * 缺席，而根本沒有人點過那些名。系統替沒發生過的判斷寫了一個答案。
 *
 * 這裡守兩件事，兩件都**只在路由層看得到**（沒有純函式參與這個決定）：
 * 刪除而不是改寫、以及**已經點過名的日子不動**。
 */
describe('DELETE /api/leaves/:id —— 出勤紀錄的處理', () => {
  function createDeleteApp() {
    const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
    const filters: Array<[string, unknown]> = [];

    const supabase = {
      from(table: string) {
        const query: Record<string, unknown> = {
          select: () => query,
          eq: (column: string, value: unknown) => {
            filters.push([`${table}.${column}`, value]);
            return query;
          },
          in: () => query,
          gte: () => query,
          lte: () => query,
          is: (column: string, value: unknown) => {
            filters.push([`${table}.is.${column}`, value]);
            return query;
          },
          update: (payload: unknown) => {
            calls.push({ table, op: 'update', payload });
            return query;
          },
          delete: () => {
            calls.push({ table, op: 'delete' });
            return query;
          },
          insert: () => Promise.resolve({ error: null }),
          single: () =>
            Promise.resolve({
              data: {
                id: 'leave-1',
                student_id: 'stu-1',
                // 已經結束的假 → 走「完整刪除」那條，不是 truncate
                start_date: '2026-04-01',
                end_date: '2026-04-02',
                students: { name: '王小明' },
              },
              error: null,
            }),
          then: (onfulfilled?: ((value: { data: unknown[] }) => unknown) | null) => {
            const data =
              table === 'events'
                ? [{ id: 'ev-untaken' }]
                : table === 'attendance_records'
                  ? [{ id: 'rec-1' }]
                  : [];
            return Promise.resolve({ data }).then(onfulfilled ?? undefined);
          },
        };
        return query;
      },
    };

    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      const context = c as unknown as { set: (key: string, value: unknown) => void };
      context.set('supabase', supabase);
      context.set('orgId', 'org-1');
      context.set('userId', 'user-1');
      context.set('roles', ['admin']);
      await next();
    });
    app.route('/api/leaves', leavesApp);

    return { app, calls, filters };
  }

  it('把 on_leave 紀錄刪掉，而不是改寫成 absent', async () => {
    const { app, calls } = createDeleteApp();

    const res = await app.request(
      '/api/leaves/00000000-0000-4000-8000-000000000001?mode=full',
      { method: 'DELETE' },
      undefined,
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
    );

    expect(res.status).toBe(204);
    expect(calls).toContainEqual({ table: 'attendance_records', op: 'delete' });
    // 改成 absent 就是替沒發生過的判斷寫一個答案
    expect(
      calls.filter((call) => call.table === 'attendance_records' && call.op === 'update'),
    ).toHaveLength(0);
  });

  it('只碰還沒點名的課堂 —— 已點過名的日子維持不動', async () => {
    const { app, filters } = createDeleteApp();

    await app.request(
      '/api/leaves/00000000-0000-4000-8000-000000000001?mode=full',
      { method: 'DELETE' },
      undefined,
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
    );

    // 那天有人真的看過名單、做過判斷；假被刪掉不代表可以回頭改寫別人做完的事
    expect(filters).toContainEqual(['events.is.attendance_taken_at', null]);
  });
});
