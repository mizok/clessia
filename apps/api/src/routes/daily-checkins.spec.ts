import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import dailyCheckinsApp from './daily-checkins';

/**
 * 掃碼是**自動寫入**：機器讀到一張卡，就替該學生當天所有課程記一筆 `present`。
 *
 * **它不得覆蓋人工改過的紀錄。** 老師把某個學生改成缺席、學生事後補掃了碼，
 * 原本的 upsert（`ignoreDuplicates: false`）會把它改回 present，而且不留痕跡 ——
 * 老師的判斷被一張卡推翻，沒有人會知道。
 *
 * 這裡守的是 upsert 的**選項**，不是結果：兩種寫法在假 supabase 的回傳上看不出差別，
 * 差別只存在於「送給 PostgREST 的是哪一組參數」。
 */
function createCheckinApp(
  fixture: {
    events?: Array<{ id: string; sessions: unknown }>;
    enrollments?: Array<{ class_id: string; effective_from: string; effective_to: string | null }>;
  } = {},
) {
  const upsertCalls: Array<{ table: string; rows: unknown; options: unknown }> = [];

  const supabase = {
    from(table: string) {
      const query = {
        upsert(rows: unknown, options: unknown) {
          upsertCalls.push({ table, rows, options });
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    id: '00000000-0000-4000-8000-000000000001',
                    org_id: '00000000-0000-4000-8000-0000000000a1',
                    student_id: '00000000-0000-4000-8000-0000000000b1',
                    campus_id: null,
                    checkin_date: '2026-04-01',
                    checked_in_at: '2026-04-01T00:00:00Z',
                    created_at: '2026-04-01T00:00:00Z',
                  },
                  error: null,
                }),
            }),
            then: (onfulfilled?: ((value: { error: null }) => unknown) | null) =>
              Promise.resolve({ error: null }).then(onfulfilled ?? undefined),
          };
        },
        select: () => query,
        eq: () => query,
        then: (onfulfilled?: ((value: { data: unknown[] }) => unknown) | null) => {
          const data =
            table === 'enrollments'
              ? (fixture.enrollments ?? [
                  { class_id: 'class-1', effective_from: '2020-01-01', effective_to: null },
                ])
              : (fixture.events ?? [
                  { id: 'event-1', sessions: [{ class_id: 'class-1' }] },
                  { id: 'event-2', sessions: [{ class_id: 'class-1' }] },
                ]);
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
    context.set('orgId', '00000000-0000-4000-8000-0000000000a1');
    context.set('userId', 'user-1');
    context.set('roles', ['admin']);
    // 這組測試的主題不是分校範圍 —— 宣告成「不受分校限制」，那也是正式站對
    // 老師／家長的實際值（`resolveCampusScope` 對非管理員回 null）。**不宣告的話
    // 會走進 `getCampusScope` 的缺席分支，那是 authMiddleware 沒跑的錯誤狀態。**
    context.set('campusScope', null);
    await next();
  });
  app.route('/api/daily-checkins', dailyCheckinsApp);

  return { app, upsertCalls };
}

describe('POST /api/daily-checkins', () => {
  it('never overwrites an existing attendance record', async () => {
    const { app, upsertCalls } = createCheckinApp();

    const response = await app.request('/api/daily-checkins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        studentId: '00000000-0000-4000-8000-0000000000b1',
        checkinDate: '2026-04-01',
      }),
    });

    expect(response.status).toBe(201);

    const attendanceUpsert = upsertCalls.find((call) => call.table === 'attendance_records');
    expect(attendanceUpsert).toBeDefined();
    // 已經有紀錄的就跳過 —— 那筆可能是老師手動改的
    expect(attendanceUpsert?.options).toMatchObject({ ignoreDuplicates: true });
  });

  it('records the scan as an automatic write', async () => {
    const { app, upsertCalls } = createCheckinApp();

    await app.request('/api/daily-checkins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        studentId: '00000000-0000-4000-8000-0000000000b1',
        checkinDate: '2026-04-01',
      }),
    });

    const rows = upsertCalls.find((call) => call.table === 'attendance_records')?.rows as Array<
      Record<string, unknown>
    >;

    // 掃碼是機器寫的，不是人 —— 這一欄之後要用來分辨「能不能覆蓋」
    expect(rows.every((row) => row['recorded_by_role'] === 'system')).toBe(true);
    expect(rows.every((row) => row['status'] === 'present')).toBe(true);
  });
});

/**
 * **掃碼只算報名的課**（使用者 2026-09-03 裁定）。
 *
 * 原本是「當天這個分校的所有課堂」都寫 present —— 包含學生根本沒報名的班，
 * 於是出勤紀錄裡冒出他從來沒上過的課，而那些紀錄會流進扣課與月結。
 *
 * 純函式（`enrolled-events.spec.ts`）守的是過濾規則本身；這裡守的是
 * **路由真的去查了在籍、而且真的拿去濾** —— 完全不濾的版本一樣通過那些測試。
 */
describe('POST /api/daily-checkins —— 只寫有報名的課堂', () => {
  async function checkin(fixture: Parameters<typeof createCheckinApp>[0]) {
    const { app, upsertCalls } = createCheckinApp(fixture);
    const response = await app.request('/api/daily-checkins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        studentId: '00000000-0000-4000-8000-0000000000b1',
        checkinDate: '2026-04-06',
      }),
    });
    const attendance = upsertCalls.find((call) => call.table === 'attendance_records');
    return {
      status: response.status,
      eventIds: ((attendance?.rows ?? []) as Array<Record<string, unknown>>).map(
        (row) => row['event_id'],
      ),
    };
  }

  it('沒報名的班不寫出勤', async () => {
    const { eventIds } = await checkin({
      events: [
        { id: 'ev-enrolled', sessions: [{ class_id: 'class-1' }] },
        { id: 'ev-other', sessions: [{ class_id: 'class-2' }] },
      ],
      enrollments: [{ class_id: 'class-1', effective_from: '2020-01-01', effective_to: null }],
    });

    expect(eventIds).toEqual(['ev-enrolled']);
  });

  it('一堂都沒報名時 —— 到班紀錄照建，只是不產生課堂出勤', async () => {
    const { status, eventIds } = await checkin({
      events: [{ id: 'ev-other', sessions: [{ class_id: 'class-2' }] }],
      enrollments: [],
    });

    // 人到了就是到了，即使他今天一堂課都沒有 —— 兩層分開
    expect(status).toBe(201);
    expect(eventIds).toEqual([]);
  });

  it('在籍已經結束的班不寫', async () => {
    const { eventIds } = await checkin({
      events: [{ id: 'ev-1', sessions: [{ class_id: 'class-1' }] }],
      enrollments: [
        { class_id: 'class-1', effective_from: '2020-01-01', effective_to: '2026-04-05' },
      ],
    });

    expect(eventIds).toEqual([]);
  });
});

/**
 * 取消打卡。**兩件事只在路由層看得到**：走的是既有的補登窗（不是另一套），
 * 以及衍生紀錄是**刪掉而不是改成 absent**。
 */
describe('DELETE /api/daily-checkins/:id', () => {
  function createCancelApp(options: {
    eventDate: string;
    responsible?: string;
    retroDays?: number;
  }) {
    const calls: Array<{ table: string; op: string; filters: Array<[string, unknown]> }> = [];
    const queriedTables: string[] = [];

    const supabase = {
      from(table: string) {
        queriedTables.push(table);
        const filters: Array<[string, unknown]> = [];
        const query: Record<string, unknown> = {
          select: () => query,
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return query;
          },
          in: () => query,
          maybeSingle: () =>
            Promise.resolve({
              data:
                table === 'daily_checkins'
                  ? {
                      id: 'checkin-1',
                      student_id: 'stu-1',
                      checkin_date: options.eventDate,
                      campus_id: null,
                    }
                  : table === 'organizations'
                    ? {
                        attendance_responsible: options.responsible ?? 'admin',
                        attendance_retroactive_days: options.retroDays ?? 0,
                      }
                    : null,
              error: null,
            }),
          delete: () => {
            calls.push({ table, op: 'delete', filters });
            return query;
          },
          update: () => {
            calls.push({ table, op: 'update', filters });
            return query;
          },
          insert: () => Promise.resolve({ error: null }),
          then: (onfulfilled?: ((value: { data: unknown[] }) => unknown) | null) => {
            const data =
              table === 'events'
                ? [{ id: 'ev-1' }]
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
      context.set('campusScope', null);
      await next();
    });
    app.route('/api/daily-checkins', dailyCheckinsApp);

    return { app, calls, queriedTables };
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());

  async function cancel(options: Parameters<typeof createCancelApp>[0]) {
    const { app, calls, queriedTables } = createCancelApp(options);
    const response = await app.request(
      '/api/daily-checkins/00000000-0000-4000-8000-000000000001',
      { method: 'DELETE' },
      undefined,
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
    );
    return {
      status: response.status,
      body: await response.json().catch(() => null),
      calls,
      queriedTables,
    };
  }

  it('刪掉打卡與它寫出來的出勤紀錄 —— 不是改成 absent', async () => {
    const { status, body, calls } = await cancel({ eventDate: today });

    expect(status).toBe(200);
    expect(body).toMatchObject({ attendanceRecordsRemoved: 1 });
    expect(calls.some((call) => call.table === 'attendance_records' && call.op === 'delete')).toBe(
      true,
    );
    // 改成 absent 就是替沒發生過的判斷寫一個答案
    expect(calls.some((call) => call.table === 'attendance_records' && call.op === 'update')).toBe(
      false,
    );
    expect(calls.some((call) => call.table === 'daily_checkins' && call.op === 'delete')).toBe(
      true,
    );
  });

  it('只刪掃碼寫的那些 —— 老師手動改過的不能被一次取消打卡抹掉', async () => {
    const { calls } = await cancel({ eventDate: today });

    const del = calls.find((call) => call.table === 'attendance_records' && call.op === 'delete');
    expect(del?.filters).toContainEqual(['recorded_by_role', 'system']);
    expect(del?.filters).toContainEqual(['status', 'present']);
  });

  it('走既有的補登窗 —— 而不是另寫一份判斷', async () => {
    const { queriedTables } = await cancel({ eventDate: '2020-01-01' });

    // `assertAttendanceWindow` 讀 organizations 的 attendance_responsible /
    // attendance_retroactive_days。沒有這一步就代表這支端點自己判斷了時窗 ——
    // 那樣同一間補習班對「昨天還能不能改」會有兩個答案。
    expect(queriedTables).toContain('organizations');
  });
});
