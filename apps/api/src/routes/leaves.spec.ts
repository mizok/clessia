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
  function createDeleteApp(leaveDates?: { start: string; end: string }) {
    const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
    const filters: Array<[string, unknown]> = [];
    // 稽核寫入的內容 —— **替身缺 `maybeSingle` 的時候，`logAudit` 會在它自己的
    // try/catch 裡靜默失敗**（只印一行 `[audit] log failed`），於是「有沒有寫稽核」
    // 在測試裡永遠是不可觀察的。補齊方法之後它才變成可以斷言的東西。
    const auditRows: Array<Record<string, unknown>> = [];

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
          // `logAudit` 會先查 profiles 拿 display_name —— 少了這個方法，
          // 整支稽核就在 catch 裡消失
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          insert: (payload: Record<string, unknown>) => {
            if (table === 'audit_logs') auditRows.push(payload);
            return Promise.resolve({ error: null });
          },
          single: () =>
            Promise.resolve({
              data: {
                id: 'leave-1',
                student_id: 'stu-1',
                // 已經結束的假 → 走「完整刪除」那條，不是 truncate
                start_date: leaveDates?.start ?? '2026-04-01',
                end_date: leaveDates?.end ?? '2026-04-02',
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

    return { app, calls, filters, auditRows };
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

  it('進行中的假只截短、不放寬 —— 縮短造不出新的重疊', async () => {
    // 「請假不得重疊」沒有 DB 約束，只靠 POST 的檢查。截短是唯一會改動既有區間的路徑，
    // 所以它必須只會讓區間變窄 —— 放寬的話就繞過了那個檢查。
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
    const yesterday = new Date(`${today}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayText = yesterday.toISOString().slice(0, 10);

    const { app, calls } = createDeleteApp({ start: '2020-01-01', end: '2099-12-31' });

    await app.request(
      '/api/leaves/00000000-0000-4000-8000-000000000001?mode=truncate',
      { method: 'DELETE' },
      undefined,
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
    );

    const update = calls.find((call) => call.table === 'leave_requests' && call.op === 'update');
    // 寫回去的迄日是昨天 —— 嚴格早於原本的 2099-12-31，也早於今天
    expect(update?.payload).toEqual({ end_date: yesterdayText });
    expect(yesterdayText < '2099-12-31').toBe(true);
  });

  it('稽核有被寫進去 —— 而不是在 logAudit 的 catch 裡消失', async () => {
    const { app, auditRows } = createDeleteApp();

    await app.request(
      '/api/leaves/00000000-0000-4000-8000-000000000001?mode=full',
      { method: 'DELETE' },
      undefined,
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
    );

    // 刪除請假是「使用者選了不留痕作廢」的動作，稽核是我們唯一的底線 ——
    // 它靜默失敗的話，事後沒有任何辦法知道那張假原本是什麼
    expect(auditRows.some((row) => row['action'] === 'delete')).toBe(true);
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

/**
 * **請假不得重疊，是一條只活在一段路由碼裡的不變量。**
 *
 * 沒有 DB 排他約束（那要 migration，保留類），也沒有任何測試守著它 ——
 * 而**別的功能的正確性論證正靠著它**：#265 的連坐預測之所以在正式資料上單純，
 * 是因為「兩張接力假」根本建不出來（共用端點日會被 409 擋掉）。
 *
 * 最容易被「優化」掉的是**共用單日端點那條**：把 `lte/gte` 改成 `lt/gt` 看起來
 * 只是修掉一個「多餘的」邊界，實際上是打開接力假 —— 而打開之後，
 * roster 的聚合值就會開始騙人（`[4/4~4/6] + [4/6~4/8]` 跟一張 `[4/4~4/8]` 同形）。
 * 所以這裡守的是**過濾條件本身**，不只是回應碼。
 */
describe('POST /api/leaves —— 重疊檢查', () => {
  function createApp(existing: Array<{ start_date: string; end_date: string }>) {
    const filters: Array<[string, unknown]> = [];
    const inserted: Array<Record<string, unknown>> = [];

    const supabase = {
      from(table: string) {
        const predicates: Array<(row: { start_date: string; end_date: string }) => boolean> = [];
        const query: Record<string, unknown> = {
          select: () => query,
          eq: (column: string, value: unknown) => {
            filters.push([`${table}.eq.${column}`, value]);
            return query;
          },
          // **替身要照路由實際用的運算子過濾，不能無條件回全部。**
          // 無條件回全部的話「沒有重疊」那條會因為錯的理由而 409，
          // 而「共用端點日」那條會因為錯的理由而通過 —— 兩條都不再檢驗邊界。
          // 照著記下來的運算子套用，路由把 lte 改成 lt 時替身的行為就跟著變。
          lte: (column: string, value: unknown) => {
            filters.push([`${table}.lte.${column}`, value]);
            predicates.push((row) => String(row[column as 'start_date']) <= String(value));
            return query;
          },
          lt: (column: string, value: unknown) => {
            filters.push([`${table}.lt.${column}`, value]);
            predicates.push((row) => String(row[column as 'start_date']) < String(value));
            return query;
          },
          gte: (column: string, value: unknown) => {
            filters.push([`${table}.gte.${column}`, value]);
            predicates.push((row) => String(row[column as 'end_date']) >= String(value));
            return query;
          },
          gt: (column: string, value: unknown) => {
            filters.push([`${table}.gt.${column}`, value]);
            predicates.push((row) => String(row[column as 'end_date']) > String(value));
            return query;
          },
          in: () => query,
          or: () => query,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          single: () =>
            Promise.resolve({
              data: {
                id: 'leave-new',
                org_id: 'org-1',
                student_id: 'stu-1',
                start_date: '2026-04-06',
                end_date: '2026-04-08',
                start_time: null,
                end_time: null,
                reason: null,
                submitted_by: 'user-1',
                submitted_by_role: 'admin',
                created_at: '2026-04-01T00:00:00Z',
                updated_at: '2026-04-01T00:00:00Z',
                students: { name: '王小明' },
              },
              error: null,
            }),
          insert: (payload: Record<string, unknown>) => {
            if (table === 'leave_requests') inserted.push(payload);
            return query;
          },
          upsert: () => Promise.resolve({ error: null }),
          then: (onfulfilled?: ((value: { data: unknown[] }) => unknown) | null) => {
            const data =
              table === 'leave_requests'
                ? existing.filter((row) => predicates.every((match) => match(row)))
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

    return { app, filters, inserted };
  }

  async function create(
    existing: Array<{ start_date: string; end_date: string }>,
    body: { startDate: string; endDate: string },
  ) {
    const { app, filters, inserted } = createApp(existing);
    const response = await app.request(
      '/api/leaves',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          studentId: '00000000-0000-4000-8000-0000000000b1',
          ...body,
        }),
      },
      undefined,
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
    );
    return { status: response.status, filters, inserted };
  }

  it('完全重疊 → 409，而且不會寫進去', async () => {
    const { status, inserted } = await create(
      [{ start_date: '2026-04-04', end_date: '2026-04-08' }],
      {
        startDate: '2026-04-05',
        endDate: '2026-04-07',
      },
    );

    expect(status).toBe(409);
    expect(inserted).toEqual([]);
  });

  it('⚠️ 共用單日端點也要 409 —— 這是最容易被「優化」掉的邊界', async () => {
    // 既有 4/4~4/6，新的 4/6~4/8：只重疊 4/6 那一天。
    // 放行的話就造出「兩張接力假」，而那正是 roster 的 min/max 聚合分不出來的形狀
    const { status, inserted } = await create(
      [{ start_date: '2026-04-04', end_date: '2026-04-06' }],
      {
        startDate: '2026-04-06',
        endDate: '2026-04-08',
      },
    );

    expect(status).toBe(409);
    expect(inserted).toEqual([]);
  });

  it('守的是過濾條件本身：`lte(start, 新的迄)` + `gte(end, 新的起)`', async () => {
    // 端點日算不算重疊，全看這兩個條件是 lte/gte 還是 lt/gt。
    // 只斷言回應碼的話，改成 lt/gt 之後這組測試資料仍然會 409（因為還有別的天重疊），
    // 邊界就悄悄鬆掉了 —— 所以直接釘住條件
    const { filters } = await create([], { startDate: '2026-04-06', endDate: '2026-04-08' });

    expect(filters).toContainEqual(['leave_requests.lte.start_date', '2026-04-08']);
    expect(filters).toContainEqual(['leave_requests.gte.end_date', '2026-04-06']);
  });

  it('完全沒碰到的日期 → 建立成功', async () => {
    const { status, inserted } = await create(
      [{ start_date: '2026-04-01', end_date: '2026-04-03' }],
      {
        startDate: '2026-04-06',
        endDate: '2026-04-08',
      },
    );

    expect(status).toBe(201);
    expect(inserted).toHaveLength(1);
  });
});
