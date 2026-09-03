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
}) {
  const queried: string[] = [];

  const supabase = {
    from(table: string) {
      queried.push(table);
      const query: Record<string, unknown> = {
        select: () => query,
        eq: () => query,
        in: () => query,
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
    context.set('campusScope', null);
    await next();
  });
  app.route('/api/workbench', workbenchApp);

  return { app, queried };
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
  const { app, queried } = createWorkbenchApp(fixture);
  const response = await app.request(`/api/workbench/today?date=2026-04-06${query}`);
  return { status: response.status, body: (await response.json()) as any, queried };
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
