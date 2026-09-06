import { Hono } from 'hono';
import { describe, it, expect } from 'vitest';

import leavesApp from './leaves';
import {
  buildLeaveAttendanceAuditDetails,
  buildLeaveAuditResourceName,
  buildLeaveAttendanceUpserts,
  diffLeaveDateRanges,
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

  it('skips cancelled sessions', () => {
    const rows = buildLeaveAttendanceUpserts({
      orgId: 'org-1',
      studentId: 'student-1',
      recordedBy: 'user-1',
      events: [
        {
          id: 'event-1',
          event_date: '2026-04-02',
          sessions: { class_id: 'class-1', status: 'cancelled' },
        },
      ],
      enrollments: [
        { class_id: 'class-1', effective_from: '2026-04-01', effective_to: null },
      ],
    });

    expect(rows).toEqual([]);
  });

  it('skips cancelled sessions returned as an array', () => {
    const rows = buildLeaveAttendanceUpserts({
      orgId: 'org-1',
      studentId: 'student-1',
      recordedBy: 'user-1',
      events: [
        {
          id: 'event-1',
          event_date: '2026-04-02',
          sessions: [{ class_id: 'class-1', status: 'cancelled' }],
        },
      ],
      enrollments: [
        { class_id: 'class-1', effective_from: '2026-04-01', effective_to: null },
      ],
    });

    expect(rows).toEqual([]);
  });

  it('still marks scheduled sessions', () => {
    const rows = buildLeaveAttendanceUpserts({
      orgId: 'org-1',
      studentId: 'student-1',
      recordedBy: 'user-1',
      events: [
        {
          id: 'event-1',
          event_date: '2026-04-02',
          sessions: { class_id: 'class-1', status: 'scheduled' },
        },
      ],
      enrollments: [
        { class_id: 'class-1', effective_from: '2026-04-01', effective_to: null },
      ],
    });

    expect(rows).toHaveLength(1);
  });

  // 釘住預設方向：**沒帶 `status` 就照舊寫**。反過來的話，呼叫端漏 `select('status')`
  // 會讓整批 `on_leave` 靜靜消失而且沒有訊號 —— 比多寫幾筆難發現得多。
  // 少了這支，下一個人會把那個方向當成漏寫的守衛然後「修好」它。
  it('writes the record when status is absent — the deliberate fallback direction', () => {
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
      ],
      enrollments: [
        { class_id: 'class-1', effective_from: '2026-04-01', effective_to: null },
      ],
    });

    expect(rows).toHaveLength(1);
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

describe('diffLeaveDateRanges', () => {
  // 期望值全部是**手寫的字面日期**，不是拿 `addDaysToDateString` 再算一次 ——
  // 用被測程式碼自己的算法算期望值，測的只是「兩份抄本一不一致」（charter 第八個案例）。
  it('往後縮短 → 只有尾巴那一段被撤銷', () => {
    expect(
      diffLeaveDateRanges(
        { startDate: '2026-04-01', endDate: '2026-04-10' },
        { startDate: '2026-04-01', endDate: '2026-04-05' },
      ),
    ).toEqual({
      removed: [{ startDate: '2026-04-06', endDate: '2026-04-10' }],
      added: [],
    });
  });

  it('往前縮短 → 只有頭那一段被撤銷', () => {
    expect(
      diffLeaveDateRanges(
        { startDate: '2026-04-01', endDate: '2026-04-10' },
        { startDate: '2026-04-04', endDate: '2026-04-10' },
      ),
    ).toEqual({
      removed: [{ startDate: '2026-04-01', endDate: '2026-04-03' }],
      added: [],
    });
  });

  it('兩頭都放寬 → 兩段各自新增，中間那段不重寫', () => {
    expect(
      diffLeaveDateRanges(
        { startDate: '2026-04-05', endDate: '2026-04-06' },
        { startDate: '2026-04-03', endDate: '2026-04-09' },
      ),
    ).toEqual({
      removed: [],
      added: [
        { startDate: '2026-04-03', endDate: '2026-04-04' },
        { startDate: '2026-04-07', endDate: '2026-04-09' },
      ],
    });
  });

  it('整段搬走（新舊完全不重疊）→ 舊的整段撤銷、新的整段寫入', () => {
    expect(
      diffLeaveDateRanges(
        { startDate: '2026-04-01', endDate: '2026-04-03' },
        { startDate: '2026-04-10', endDate: '2026-04-12' },
      ),
    ).toEqual({
      removed: [{ startDate: '2026-04-01', endDate: '2026-04-03' }],
      added: [{ startDate: '2026-04-10', endDate: '2026-04-12' }],
    });
  });

  it('只差一天的相鄰區間仍算「不重疊」—— 端點日不共用', () => {
    // 4/1~4/3 → 4/4~4/6：沒有任何一天共用，所以是整段搬走而不是兩頭平移。
    // 這條釘住的是「相鄰」與「重疊」的分界，寫錯會讓 removed/added 各多一段空區間。
    expect(
      diffLeaveDateRanges(
        { startDate: '2026-04-01', endDate: '2026-04-03' },
        { startDate: '2026-04-04', endDate: '2026-04-06' },
      ),
    ).toEqual({
      removed: [{ startDate: '2026-04-01', endDate: '2026-04-03' }],
      added: [{ startDate: '2026-04-04', endDate: '2026-04-06' }],
    });
  });

  it('完全沒動 → 兩邊都空，不做任何出勤異動', () => {
    expect(
      diffLeaveDateRanges(
        { startDate: '2026-04-01', endDate: '2026-04-03' },
        { startDate: '2026-04-01', endDate: '2026-04-03' },
      ),
    ).toEqual({ removed: [], added: [] });
  });

  it('跨月邊界 —— 月初往前一天不是 00 號', () => {
    expect(
      diffLeaveDateRanges(
        { startDate: '2026-03-28', endDate: '2026-04-05' },
        { startDate: '2026-04-01', endDate: '2026-04-05' },
      ),
    ).toEqual({
      removed: [{ startDate: '2026-03-28', endDate: '2026-03-31' }],
      added: [],
    });
  });
});

/**
 * **PATCH 是第二條會改動既有請假區間的路徑，而且是第一條會「放寬」的。**
 *
 * DELETE 的 truncate 只會讓區間變窄，所以它繞不過 POST 的重疊檢查；
 * 編輯可以把區間拉長，於是「請假不得重疊」這條只活在路由碼裡的不變量
 * （沒有 DB 約束，見上方 POST 那節的說明）必須在這裡再守一次 —— 而且要排除自己，
 * 否則每一次編輯都會跟自己重疊、變成永遠 409。
 */
describe('PATCH /api/leaves/:id', () => {
  interface FakeQueryRecord {
    table: string;
    op: 'select' | 'update' | 'delete' | 'upsert' | 'insert';
    eqs: Array<[string, unknown]>;
    neqs: Array<[string, unknown]>;
    gte?: [string, unknown];
    lte?: [string, unknown];
    isNull: string[];
    payload?: unknown;
  }

  const LEAVE_ID = '00000000-0000-4000-8000-000000000001';

  function createPatchApp(options?: {
    leave?: Partial<{
      start_date: string;
      end_date: string;
      start_time: string | null;
      end_time: string | null;
      reason: string | null;
    }>;
    otherLeaves?: Array<{ id: string; start_date: string; end_date: string }>;
  }) {
    const leave = {
      id: LEAVE_ID,
      org_id: 'org-1',
      student_id: 'stu-1',
      start_date: '2026-04-01',
      end_date: '2026-04-10',
      start_time: null as string | null,
      end_time: null as string | null,
      reason: null as string | null,
      submitted_by: 'user-1',
      submitted_by_role: 'admin' as const,
      created_at: '2026-03-30T00:00:00Z',
      ...options?.leave,
    };
    const otherLeaves = options?.otherLeaves ?? [];

    const queries: FakeQueryRecord[] = [];
    const auditRows: Array<Record<string, unknown>> = [];

    const supabase = {
      from(table: string) {
        const record: FakeQueryRecord = { table, op: 'select', eqs: [], neqs: [], isNull: [] };
        queries.push(record);

        const query: Record<string, unknown> = {
          select: () => query,
          eq: (column: string, value: unknown) => {
            record.eqs.push([column, value]);
            return query;
          },
          neq: (column: string, value: unknown) => {
            record.neqs.push([column, value]);
            return query;
          },
          gte: (column: string, value: unknown) => {
            record.gte = [column, value];
            return query;
          },
          lte: (column: string, value: unknown) => {
            record.lte = [column, value];
            return query;
          },
          is: (column: string, value: unknown) => {
            if (value === null) record.isNull.push(column);
            return query;
          },
          in: () => query,
          or: () => query,
          order: () => query,
          update: (payload: unknown) => {
            record.op = 'update';
            record.payload = payload;
            return query;
          },
          delete: () => {
            record.op = 'delete';
            return query;
          },
          upsert: (payload: unknown) => {
            record.op = 'upsert';
            record.payload = payload;
            return Promise.resolve({ error: null });
          },
          insert: (payload: Record<string, unknown>) => {
            record.op = 'insert';
            if (table === 'audit_logs') auditRows.push(payload);
            return Promise.resolve({ error: null });
          },
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          single: () => {
            if (record.op === 'update') {
              return Promise.resolve({
                data: { ...leave, ...(record.payload as object), students: { name: '王小明' } },
                error: null,
              });
            }
            return Promise.resolve({ data: { ...leave, students: { name: '王小明' } }, error: null });
          },
          then: (onfulfilled?: ((value: { data: unknown[] }) => unknown) | null) => {
            let data: unknown[] = [];
            if (table === 'leave_requests') {
              // 重疊查詢：照路由實際下的 lte/gte 過濾，替身才分得出對錯的實作
              data = otherLeaves.filter((row) => {
                if (record.lte && String(row[record.lte[0] as 'start_date']) > String(record.lte[1]))
                  return false;
                if (record.gte && String(row[record.gte[0] as 'end_date']) < String(record.gte[1]))
                  return false;
                if (record.neqs.some(([col, value]) => row[col as 'id'] === value)) return false;
                return true;
              });
            } else if (table === 'events') {
              data = [
                { id: 'ev-1', event_date: record.gte?.[1] as string, sessions: { class_id: 'c1' } },
              ];
            } else if (table === 'enrollments') {
              data = [{ class_id: 'c1', effective_from: '2020-01-01', effective_to: null }];
            } else if (table === 'attendance_records') {
              data = [{ id: 'rec-1' }];
            }
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

    async function patch(body: Record<string, unknown>) {
      const response = await app.request(
        `/api/leaves/${LEAVE_ID}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        undefined,
        { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
      );
      return response;
    }

    return { patch, queries, auditRows };
  }

  it('縮短 → 只撤銷被砍掉那一段，而且只碰還沒點名的課堂', async () => {
    const { patch, queries } = createPatchApp();
    const res = await patch({ endDate: '2026-04-05' });

    expect(res.status).toBe(200);

    const eventQueries = queries.filter((q) => q.table === 'events');
    expect(eventQueries).toHaveLength(1);
    // 撤銷的範圍是 4/6~4/10（被砍掉那一段），**不是整張假的 4/1~4/10** ——
    // 對整段撤銷會把還留著的日子一起清掉
    expect(eventQueries[0]?.gte).toEqual(['event_date', '2026-04-06']);
    expect(eventQueries[0]?.lte).toEqual(['event_date', '2026-04-10']);
    // 那天有人真的看過名單、做過判斷；改短一張假不代表可以回頭改寫別人做完的事
    expect(eventQueries[0]?.isNull).toContain('attendance_taken_at');

    expect(
      queries.some((q) => q.table === 'attendance_records' && q.op === 'delete'),
    ).toBe(true);
    // 縮短不會產生新的 on_leave
    expect(queries.some((q) => q.table === 'attendance_records' && q.op === 'upsert')).toBe(false);
  });

  it('延長 → 只對新增那一段寫 on_leave，原本的區間不重寫', async () => {
    const { patch, queries } = createPatchApp();
    const res = await patch({ endDate: '2026-04-14' });

    expect(res.status).toBe(200);

    const eventQueries = queries.filter((q) => q.table === 'events');
    expect(eventQueries).toHaveLength(1);
    expect(eventQueries[0]?.gte).toEqual(['event_date', '2026-04-11']);
    expect(eventQueries[0]?.lte).toEqual(['event_date', '2026-04-14']);
    // 新增段走的是「建立請假」那條路：找 session 事件，**不**濾 attendance_taken_at
    // （補請假覆蓋既有紀錄是刻意的，見 #145）
    expect(eventQueries[0]?.eqs).toContainEqual(['event_type', 'session']);
    expect(eventQueries[0]?.isNull).not.toContain('attendance_taken_at');

    expect(queries.some((q) => q.table === 'attendance_records' && q.op === 'upsert')).toBe(true);
    expect(queries.some((q) => q.table === 'attendance_records' && q.op === 'delete')).toBe(false);
  });

  it('重疊檢查排除自己 —— 否則每一次編輯都會跟自己撞成 409', async () => {
    const { patch, queries } = createPatchApp({
      otherLeaves: [{ id: LEAVE_ID, start_date: '2026-04-01', end_date: '2026-04-10' }],
    });
    const res = await patch({ endDate: '2026-04-12' });

    expect(res.status).toBe(200);
    const conflictQuery = queries.find((q) => q.table === 'leave_requests' && q.neqs.length > 0);
    expect(conflictQuery?.neqs).toContainEqual(['id', LEAVE_ID]);
  });

  it('⚠️ 放寬到別人的區間 → 409，而且守的是過濾條件本身', async () => {
    // 編輯是**唯一**會讓區間變寬的路徑，所以「不得重疊」在這裡是真的會被繞過的。
    // 只斷言回應碼不夠：lte/gte 換成 lt/gt 之後這組資料照樣 409（還有別的天重疊），
    // 端點日的邊界會悄悄鬆掉 —— 而端點日正是接力假的形狀
    const { patch, queries } = createPatchApp({
      otherLeaves: [{ id: 'other-1', start_date: '2026-04-12', end_date: '2026-04-15' }],
    });
    const res = await patch({ endDate: '2026-04-12' });

    expect(res.status).toBe(409);
    const conflictQuery = queries.find((q) => q.table === 'leave_requests' && q.neqs.length > 0);
    expect(conflictQuery?.lte).toEqual(['start_date', '2026-04-12']);
    expect(conflictQuery?.gte).toEqual(['end_date', '2026-04-01']);
    // 被擋下來就不能已經寫進去
    expect(queries.some((q) => q.table === 'leave_requests' && q.op === 'update')).toBe(false);
  });

  it('只改事由 → 完全不碰出勤紀錄', async () => {
    const { patch, queries } = createPatchApp();
    const res = await patch({ reason: '家中有事' });

    expect(res.status).toBe(200);
    expect(queries.some((q) => q.table === 'events')).toBe(false);
    expect(queries.some((q) => q.table === 'attendance_records')).toBe(false);
  });

  it('日期顛倒 → 400，而且沒有任何寫入', async () => {
    const { patch, queries } = createPatchApp();
    const res = await patch({ startDate: '2026-04-08', endDate: '2026-04-05' });

    expect(res.status).toBe(400);
    expect(queries.some((q) => q.op === 'update')).toBe(false);
  });

  it('空 body → 400，不是靜靜地什麼都沒做', async () => {
    // 「什麼都沒改」跟「改成功了」回一樣的 200，就是又一個「壞掉的樣子跟正常的一樣」
    const { patch, queries } = createPatchApp();
    const res = await patch({});

    expect(res.status).toBe(400);
    expect(queries.some((q) => q.op === 'update')).toBe(false);
  });

  it('稽核有被寫進去 —— 而不是在 logAudit 的 catch 裡消失', async () => {
    const { patch, auditRows } = createPatchApp();
    await patch({ endDate: '2026-04-05' });

    const updateAudit = auditRows.find((row) => row['action'] === 'update');
    expect(updateAudit).toBeDefined();
    // 改成什麼要能事後查 —— 只記「有人改過」等於沒記
    expect(updateAudit?.['details']).toMatchObject({
      before: { startDate: '2026-04-01', endDate: '2026-04-10' },
      after: { startDate: '2026-04-01', endDate: '2026-04-05' },
    });
  });
});
