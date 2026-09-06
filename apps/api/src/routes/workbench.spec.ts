import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import workbenchApp from './workbench';

/**
 * 作業台聚合端點。**驗收的核心是「形狀由 API 決定」** ——
 * `mode` 決定哪些陣列有內容，而**四個陣列一律存在**（不適用時是空陣列）。
 * 缺欄位會讓前端到處寫 `?.` 防禦，之後補上也不會有人發現。
 */
function createWorkbenchApp(fixture: {
  mode: 'per_session' | 'daily_checkin';
  sessions?: Array<Record<string, unknown>>;
  enrollments?: Array<Record<string, unknown>>;
  checkins?: Array<Record<string, unknown>>;
  leaves?: Array<Record<string, unknown>>;
  /** 這個請求的分校範圍。預設 null = 不受分校限制（多數測試的主題不是分校） */
  campusScope?: readonly string[] | null;
}) {
  const queried: string[] = [];
  const inCalls: Array<{ table: string; column: string; values: string[] }> = [];

  const supabase = {
    from(table: string) {
      queried.push(table);
      const query: Record<string, unknown> = {
        select: () => query,
        eq: () => query,
        // **記錄 `in` 的欄位與值**，不只是回自己 —— 分校範圍是靠這條下到查詢上的，
        // 而「有下」與「沒下」在替身的回傳值上完全一樣（它本來就回固定的 fixture）。
        // 這是 charter 那條「替身分不出對錯時，改測送出去的查詢長什麼樣」。
        in: (column: string, values: readonly string[]) => {
          inCalls.push({ table, column, values: [...values] });
          return query;
        },
        lte: () => query,
        gte: () => query,
        or: () => query,
        order: () => query,
        maybeSingle: () =>
          Promise.resolve({
            data: table === 'organizations' ? { attendance_mode: fixture.mode } : null,
            error: null,
          }),
        then: (onfulfilled?: ((value: { data: unknown[]; error: null }) => unknown) | null) => {
          const data =
            table === 'sessions'
              ? (fixture.sessions ?? [])
              : table === 'enrollments'
                ? (fixture.enrollments ?? [])
                : table === 'daily_checkins'
                  ? (fixture.checkins ?? [])
                  : table === 'leave_requests'
                    ? (fixture.leaves ?? [])
                    : [];
          return Promise.resolve({ data, error: null }).then(onfulfilled ?? undefined);
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
    context.set('campusScope', fixture.campusScope ?? null);
    await next();
  });
  app.route('/api/workbench', workbenchApp);

  return { app, queried, inCalls };
}

const sessionRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'session-1',
  event_id: 'event-1',
  session_date: '2026-04-06',
  start_time: '09:00:00',
  end_time: '11:00:00',
  status: 'scheduled',
  class_id: 'class-1',
  teacher_id: null,
  teacher: null,
  schedules: null,
  classes: {
    name: '數學 A',
    course_id: 'course-1',
    campus_id: 'campus-1',
    campuses: { name: '中正' },
    courses: { name: '數學' },
  },
  events: {
    id: 'event-1',
    event_date: '2026-04-06',
    start_time: '09:00:00',
    end_time: '11:00:00',
    attendance_taken_at: null,
    campus_id: 'campus-1',
    campuses: { name: '中正' },
  },
  ...overrides,
});

async function today(fixture: Parameters<typeof createWorkbenchApp>[0], query = '') {
  const { app, queried, inCalls } = createWorkbenchApp(fixture);
  const response = await app.request(`/api/workbench/today?date=2026-04-06${query}`);
  return { status: response.status, body: (await response.json()) as any, queried, inCalls };
}

describe('GET /api/workbench/today', () => {
  it('逐堂點名機構：mode 正確、rosters 有值、其餘是空陣列（不是缺欄位）', async () => {
    const { status, body } = await today({ mode: 'per_session', sessions: [sessionRow()] });

    expect(status).toBe(200);
    expect(body.mode).toBe('per_session');
    expect(body.sessions).toHaveLength(1);
    expect(body.rosters).toEqual([
      { eventId: 'event-1', enrolledCount: 0, presentCount: 0, onLeaveCount: 0, takenAt: null },
    ]);
    // 一律存在 —— 缺欄位會讓前端到處寫 ?. 防禦
    expect(body.expected).toEqual([]);
    expect(body.arrived).toEqual([]);
    expect(body.onLeave).toEqual([]);
  });

  it('日到班機構：expected / arrived / onLeave 有值，rosters 是空的', async () => {
    const { body } = await today({
      mode: 'daily_checkin',
      sessions: [sessionRow()],
      enrollments: [
        { student_id: 'stu-1', class_id: 'class-1', students: { name: '王小明', grade: 'J1' } },
      ],
      checkins: [{ id: 'checkin-1', student_id: 'stu-1', checked_in_at: '2026-04-06T01:00:00Z' }],
      leaves: [
        {
          student_id: 'stu-1',
          start_date: '2026-04-06',
          end_date: '2026-04-06',
          start_time: null,
          end_time: null,
          submitted_by_role: 'parent',
        },
      ],
    });

    expect(body.mode).toBe('daily_checkin');
    expect(body.rosters).toEqual([]);
    expect(body.expected).toEqual([
      {
        studentId: 'stu-1',
        studentName: '王小明',
        grade: 'J1',
        // 前端靠這兩個欄位依分校分組
        campusId: 'campus-1',
        campusName: '中正',
        firstSession: { startTime: '09:00', className: '數學 A' },
      },
    ]);
    expect(body.arrived).toEqual([
      { studentId: 'stu-1', checkedInAt: '2026-04-06T01:00:00Z', checkinId: 'checkin-1' },
    ]);
    expect(body.onLeave[0]).toMatchObject({ studentId: 'stu-1', submittedByRole: 'parent' });
  });

  it('mode 由伺服器讀，呼叫端傳的不算數', async () => {
    // 讓呼叫端傳等於同一個機構可能拿到兩種形狀，而那個不一致沒有人會發現
    const { body } = await today(
      { mode: 'per_session', sessions: [sessionRow()] },
      '&mode=daily_checkin',
    );

    expect(body.mode).toBe('per_session');
    expect(body.rosters).toHaveLength(1);
  });

  it('停課（沒有 eventId）不進 rosters —— 沒有事件就點不了名', async () => {
    const { body } = await today({
      mode: 'per_session',
      sessions: [sessionRow({ status: 'cancelled', event_id: null, events: null })],
    });

    expect(body.sessions).toHaveLength(1);
    expect(body.rosters).toEqual([]);
  });

  it('不帶 date 時用台北時區的今天', async () => {
    const { app } = createWorkbenchApp({ mode: 'per_session', sessions: [] });
    const response = await app.request('/api/workbench/today');
    const body = (await response.json()) as { date: string };

    const taipeiToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(
      new Date(),
    );
    expect(body.date).toBe(taipeiToday);
  });

  it('逐堂模式不去查在籍、打卡與請假 —— 那三支是日到班才要的', async () => {
    const { queried } = await today({ mode: 'per_session', sessions: [sessionRow()] });

    expect(queried).not.toContain('daily_checkins');
    expect(queried).not.toContain('leave_requests');
  });
});

/**
 * 分校範圍有沒有真的下到查詢上（#515 下半）。
 *
 * **這條只能斷言查詢形狀，不能斷言回傳值** —— 這支的替身回的是固定的 fixture，
 * 不管條件下對下錯都回一樣的東西。charter：**當「對的實作」與「錯的實作」會產生
 * 同樣的觀察值時，這個測試就沒有在測那件事** —— 那就換一個看得出差別的觀察點。
 *
 * 補這條的理由：`campusScope` 補上身分宣告之後（#523），這些 spec 全部綠 ——
 * 但它們驗到的是「有拿到範圍」，**不是「範圍被套用」**。後者在此之前沒有任何
 * 測試守著。
 */
describe('GET /api/workbench/today —— 分校範圍要下到查詢上', () => {
  it('受限管理員的課堂查詢帶著他的分校清單', async () => {
    const { inCalls } = await today({
      mode: 'per_session',
      sessions: [sessionRow()],
      campusScope: ['campus-1'],
    });

    expect(inCalls).toContainEqual({
      table: 'sessions',
      column: 'classes.campus_id',
      values: ['campus-1'],
    });
  });

  it('不受分校限制時不下這個條件（確認上一條不是無腦通過）', async () => {
    const { inCalls } = await today({
      mode: 'per_session',
      sessions: [sessionRow()],
      campusScope: null,
    });

    expect(inCalls.some((call) => call.column === 'classes.campus_id')).toBe(false);
  });
});
