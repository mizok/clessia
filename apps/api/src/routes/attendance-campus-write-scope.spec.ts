import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import attendanceRoute from './attendance';
import classLogsRoute from './class-logs';
import contactBookRoute from './contact-book';
import dailyCheckinsRoute from './daily-checkins';
import leavesRoute from './leaves';

/**
 * #966 C 批：出勤／請假／打卡／日誌／聯絡簿的**寫入**要守分校範圍。
 *
 * 這些端點的 body 或 path 只帶學生／課堂／班級的 id，全域 `campusRequestGuard` 看不到分校
 * （它只讀 query string）。修之前：只管 A 校的管理員可以替 B 校學生建請假（並連動出勤 ——
 * 出勤是扣堂的上游）、改 B 校的點名、刪 B 校的打卡、發 B 校的教務日誌。
 *
 * 替身不會照條件過濾：「學生在不在範圍」由 `enrollments` 回不回列決定，
 * 「課堂／班級在哪個分校」由那一列的 `campus_id` 決定。是不是**這一層**擋的，
 * 看錯誤訊息（其他 403，例如補登期限，訊息不同）。
 */
const ORG = '00000000-0000-0000-0000-0000000000aa';
const A = '00000000-0000-0000-0000-0000000000c1';
const B = '00000000-0000-0000-0000-0000000000c2';
const STUDENT = '00000000-0000-0000-0000-0000000000e1';
const EVENT = '00000000-0000-0000-0000-0000000000e2';
const CLASS = '00000000-0000-0000-0000-0000000000e3';
const ROW = '00000000-0000-0000-0000-0000000000e4';
const SCOPE_DENIED = '沒有這個分校的權限';

type Rows = Record<string, Array<Record<string, unknown>>>;

function fakeDb(rows: Rows) {
  const make = (table: string) => {
    const data = rows[table] ?? [];
    const terminal = {
      maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data, count: data.length, error: null }).then(resolve),
    };
    const builder: Record<string, unknown> = new Proxy(terminal, {
      get(target, prop: string) {
        if (prop in target) return (target as Record<string, unknown>)[prop];
        return () => builder;
      },
    });
    return builder;
  };
  return { from: (table: string) => make(table) };
}

function appWith(route: unknown, rows: Rows, scope: string[] | null = [A]) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', fakeDb(rows));
    set('orgId', ORG);
    set('userId', 'caller');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', scope);
    await next();
  });
  app.route('/', route as Hono);
  return app;
}

async function call(
  route: unknown,
  rows: Rows,
  method: string,
  path: string,
  body?: unknown,
  scope: string[] | null = [A],
) {
  const res = await appWith(route, rows, scope).request(
    path,
    {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    undefined,
    { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
  );
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  return { status: res.status, scopeDenied: res.status === 403 && json?.error === SCOPE_DENIED };
}

// #966 B6 起寫入前先驗學生屬於本 org（不分受限與否），所以兩組都要有那個學生
const student = { students: [{ id: STUDENT, org_id: ORG }] };
const notInScope: Rows = { ...student, enrollments: [] };
const inScope: Rows = {
  ...student,
  enrollments: [{ student_id: STUDENT, classes: { campus_id: A } }],
};
const leave = {
  leave_requests: [
    { id: ROW, student_id: STUDENT, start_date: '2026-04-06', end_date: '2026-04-06' },
  ],
};
const leaveBody = { studentId: STUDENT, startDate: '2026-04-06', endDate: '2026-04-06' };

describe('請假（POST 是 #966 的起點）', () => {
  it('POST /api/leaves —— B 校學生 → 403', async () => {
    expect((await call(leavesRoute, notInScope, 'POST', '/', leaveBody)).scopeDenied).toBe(true);
  });
  it('PATCH /api/leaves/:id —— B 校學生的假 → 403', async () => {
    const r = await call(leavesRoute, { ...notInScope, ...leave }, 'PATCH', `/${ROW}`, {
      reason: 'x',
    });
    expect(r.scopeDenied).toBe(true);
  });
  it('DELETE /api/leaves/:id —— B 校學生的假 → 403', async () => {
    const r = await call(leavesRoute, { ...notInScope, ...leave }, 'DELETE', `/${ROW}`);
    expect(r.scopeDenied).toBe(true);
  });
  it('反向：A 校學生不被這一層擋', async () => {
    expect((await call(leavesRoute, inScope, 'POST', '/', leaveBody)).scopeDenied).toBe(false);
    expect(
      (await call(leavesRoute, { ...inScope, ...leave }, 'DELETE', `/${ROW}`)).scopeDenied,
    ).toBe(false);
  });
  it('反向：不受分校限制的呼叫者不被分校擋（但仍驗 org，#966 B6）', async () => {
    expect((await call(leavesRoute, notInScope, 'POST', '/', leaveBody, null)).scopeDenied).toBe(
      false,
    );
  });
});

describe('出勤', () => {
  const eventIn = (campus: string | null): Rows => ({
    events: [
      { id: EVENT, event_date: '2026-04-06', campus_id: campus, sessions: [{ class_id: CLASS }] },
    ],
    attendance_records: [
      { id: ROW, event_id: EVENT, events: { event_date: '2026-04-06', campus_id: campus } },
    ],
  });

  it('POST /api/attendance —— B 校的課堂 → 403', async () => {
    const r = await call(attendanceRoute, eventIn(B), 'POST', '/', {
      studentId: STUDENT,
      eventId: EVENT,
      status: 'present',
    });
    expect(r.scopeDenied).toBe(true);
  });
  it('PATCH /api/attendance/batch —— B 校的課堂 → 403', async () => {
    const r = await call(attendanceRoute, eventIn(B), 'PATCH', '/batch', {
      eventId: EVENT,
      updates: [{ studentId: STUDENT, status: 'present' }],
    });
    expect(r.scopeDenied).toBe(true);
  });
  it('PATCH /api/attendance/:id —— B 校課堂的出勤紀錄 → 403', async () => {
    const r = await call(attendanceRoute, eventIn(B), 'PATCH', `/${ROW}`, { status: 'absent' });
    expect(r.scopeDenied).toBe(true);
  });
  it('POST /api/attendance/roster/:eventId/cancel-leave —— B 校的課堂 → 403', async () => {
    const r = await call(attendanceRoute, eventIn(B), 'POST', `/roster/${EVENT}/cancel-leave`, {
      studentId: STUDENT,
    });
    expect(r.scopeDenied).toBe(true);
  });
  it('課堂沒有 campus_id → 受限者拒絕（讀取面的 .in() 本來就看不到它）', async () => {
    const r = await call(attendanceRoute, eventIn(null), 'PATCH', '/batch', {
      eventId: EVENT,
      updates: [{ studentId: STUDENT, status: 'present' }],
    });
    expect(r.scopeDenied).toBe(true);
  });
  it('反向：A 校的課堂不被這一層擋', async () => {
    const r = await call(attendanceRoute, eventIn(A), 'PATCH', '/batch', {
      eventId: EVENT,
      updates: [{ studentId: STUDENT, status: 'present' }],
    });
    expect(r.scopeDenied).toBe(false);
  });
});

describe('打卡', () => {
  it('POST /api/daily-checkins —— 打卡分校填自己的 A、學生卻是 B 校的 → 403', async () => {
    const r = await call(dailyCheckinsRoute, notInScope, 'POST', '/', {
      studentId: STUDENT,
      campusId: A,
      checkinDate: '2026-04-06',
    });
    expect(r.scopeDenied).toBe(true);
  });
  it('DELETE /api/daily-checkins/:id —— B 校的打卡紀錄 → 403', async () => {
    const r = await call(
      dailyCheckinsRoute,
      {
        daily_checkins: [
          { id: ROW, student_id: STUDENT, campus_id: B, checkin_date: '2026-04-06' },
        ],
      },
      'DELETE',
      `/${ROW}`,
    );
    expect(r.scopeDenied).toBe(true);
  });
  it('反向：A 校學生打卡不被這一層擋', async () => {
    const r = await call(dailyCheckinsRoute, inScope, 'POST', '/', {
      studentId: STUDENT,
      campusId: A,
      checkinDate: '2026-04-06',
    });
    expect(r.scopeDenied).toBe(false);
  });
});

describe('教務日誌與聯絡簿', () => {
  it('PUT /api/class-logs —— B 校的班 → 403', async () => {
    const r = await call(classLogsRoute, { classes: [{ id: CLASS, campus_id: B }] }, 'PUT', '/', {
      classId: CLASS,
      logDate: '2026-04-06',
      homework: 'x',
    });
    expect(r.scopeDenied).toBe(true);
  });
  it('POST /api/class-logs/:id/publish —— B 校班的日誌 → 403', async () => {
    const r = await call(
      classLogsRoute,
      { class_logs: [{ id: ROW, class_id: CLASS }], classes: [{ id: CLASS, campus_id: B }] },
      'POST',
      `/${ROW}/publish`,
    );
    expect(r.scopeDenied).toBe(true);
  });
  it('PUT /api/contact-book —— B 校學生 → 403', async () => {
    const r = await call(contactBookRoute, notInScope, 'PUT', '/', {
      studentId: STUDENT,
      entryDate: '2026-04-06',
      content: 'x',
    });
    expect(r.scopeDenied).toBe(true);
  });
  it('反向：A 校的班不被這一層擋', async () => {
    const r = await call(classLogsRoute, { classes: [{ id: CLASS, campus_id: A }] }, 'PUT', '/', {
      classId: CLASS,
      logDate: '2026-04-06',
      homework: 'x',
    });
    expect(r.scopeDenied).toBe(false);
  });
});
