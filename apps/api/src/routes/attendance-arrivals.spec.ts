import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import attendanceRoute from './attendance';
import { annotateArrivals, checkinCoversSession } from '../lib/session-arrivals';

/**
 * #1314 TS3：日到班的到班名單。
 *
 * - `POST /roster/{eventId}/check-in`（「他到了」）：老師只能記自己任課／代課、當天、在籍、
 *   日到班分校的課；行政負責點名時不給。
 * - `GET /roster/{eventId}`：受限分校的管理員讀範圍外的課堂 → 404，body 跟不存在一字不差。
 *
 * 替身不照條件過濾：每張表回固定列。「是誰擋的」看狀態碼＋`code`。
 */
const ORG = '00000000-0000-0000-0000-0000000000aa';
const A = '00000000-0000-0000-0000-0000000000c1';
const B = '00000000-0000-0000-0000-0000000000c2';
const STUDENT = '00000000-0000-0000-0000-0000000000e1';
const EVENT = '00000000-0000-0000-0000-0000000000e2';
const CLASS = '00000000-0000-0000-0000-0000000000e3';
const ME = '00000000-0000-0000-0000-0000000000f1';
const OTHER = '00000000-0000-0000-0000-0000000000f2';
const TODAY = '2026-04-06';

type Rows = Record<string, Array<Record<string, unknown>>>;

function fakeDb(rows: Rows) {
  const writes: Array<{ table: string; payload: unknown }> = [];
  const make = (table: string) => {
    const data = rows[table] ?? [];
    const terminal = {
      maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      upsert: (payload: unknown) => {
        writes.push({ table, payload });
        // 打卡 upsert 接 `.select()`：回剛寫入的那一列
        const row = { id: 'checkin-1', ...(payload as Record<string, unknown>) };
        return { select: () => Promise.resolve({ data: [row], error: null }) };
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data, error: null }).then(resolve),
    };
    const builder: Record<string, unknown> = new Proxy(terminal, {
      get(target, prop: string) {
        if (prop in target) return (target as Record<string, unknown>)[prop];
        return () => builder;
      },
    });
    return builder;
  };
  return { from: (table: string) => make(table), writes };
}

async function call(
  rows: Rows,
  opts: { method: string; path: string; roles?: string[]; scope?: string[] | null },
) {
  const db = fakeDb(rows);
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db);
    set('orgId', ORG);
    set('userId', 'caller');
    set('roles', opts.roles ?? ['teacher']);
    set('permissions', []);
    set('campusScope', opts.scope ?? null);
    await next();
  });
  app.route('/', attendanceRoute);
  const res = await app.request(
    opts.path,
    {
      method: opts.method,
      headers: { 'content-type': 'application/json' },
      body: opts.method === 'POST' ? JSON.stringify({ studentId: STUDENT }) : undefined,
    },
    undefined,
    { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
  );
  return {
    status: res.status,
    json: (await res.json().catch(() => null)) as {
      error?: string;
      code?: string;
      attendanceMode?: string;
      students?: Array<{ checkedInAt: string | null }>;
    } | null,
    writes: db.writes,
  };
}

/** 一切都對的情況：老師任課、當天、在籍、分校日到班、老師負責點名 */
function happy(over: Partial<Rows> = {}): Rows {
  return {
    organizations: [{ attendance_responsible: 'teacher', attendance_mode: 'per_session' }],
    campuses: [{ id: A, attendance_mode: 'daily_checkin' }],
    staff: [{ id: ME }],
    sessions: [{ teacher_id: ME, schedules: { teacher_id: ME } }],
    events: [{ id: EVENT, event_date: TODAY, campus_id: A, sessions: [{ class_id: CLASS }] }],
    enrollments: [{ class_id: CLASS, effective_from: '2026-01-01', effective_to: null }],
    leave_requests: [],
    daily_checkins: [],
    attendance_records: [],
    ...over,
  };
}

const checkIn = (rows: Rows, roles?: string[], scope?: string[] | null) =>
  call(rows, { method: 'POST', path: `/roster/${EVENT}/check-in`, roles, scope });

describe('POST /roster/{eventId}/check-in —— 他到了', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T04:00:00Z`)); // 台北 12:00
  });
  afterEach(() => vi.useRealTimers());

  it('任課老師、當天、在籍、日到班 → 201，寫一筆到班打卡（記錄人是老師）', async () => {
    const r = await checkIn(happy());
    expect(r.status).toBe(201);
    const checkin = r.writes.find((w) => w.table === 'daily_checkins');
    expect(checkin?.payload).toMatchObject({
      student_id: STUDENT,
      checkin_date: TODAY,
      campus_id: A,
      checked_in_by: 'caller',
    });
  });

  it('不是自己任課（也不是代課）的課 → 403 FORBIDDEN，不寫', async () => {
    const r = await checkIn(
      happy({ sessions: [{ teacher_id: OTHER, schedules: { teacher_id: OTHER } }] }),
    );
    expect(r.status).toBe(403);
    expect(r.json?.code).toBe('FORBIDDEN');
    expect(r.writes).toHaveLength(0);
  });

  it('代課的課 → 放行（點名是當天的事，代課老師就是要記那堂）', async () => {
    const r = await checkIn(
      happy({ sessions: [{ teacher_id: ME, schedules: { teacher_id: OTHER } }] }),
    );
    expect(r.status).toBe(201);
  });

  it('行政負責點名 → 403 NOT_RESPONSIBLE（老師端只看名單）', async () => {
    const r = await checkIn(
      happy({
        organizations: [{ attendance_responsible: 'admin', attendance_mode: 'per_session' }],
      }),
    );
    expect(r.status).toBe(403);
    expect(r.json?.code).toBe('NOT_RESPONSIBLE');
    expect(r.writes).toHaveLength(0);
  });

  it('不是當天的課 → 403 NOT_TODAY', async () => {
    const r = await checkIn(
      happy({
        events: [
          { id: EVENT, event_date: '2026-04-05', campus_id: A, sessions: [{ class_id: CLASS }] },
        ],
      }),
    );
    expect(r.status).toBe(403);
    expect(r.json?.code).toBe('NOT_TODAY');
    expect(r.writes).toHaveLength(0);
  });

  it('學生不在這堂課的名單上（沒報名、或報名當天不生效）→ 404 NOT_ENROLLED', async () => {
    for (const enrollments of [
      [],
      [{ class_id: CLASS, effective_from: '2026-05-01', effective_to: null }],
      [{ class_id: CLASS, effective_from: '2026-01-01', effective_to: '2026-04-05' }],
    ]) {
      const r = await checkIn(happy({ enrollments }));
      expect(r.status).toBe(404);
      expect(r.json?.code).toBe('NOT_ENROLLED');
      expect(r.writes).toHaveLength(0);
    }
  });

  it('分校是隨堂點名 → 409 NOT_DAILY_CHECKIN（記到班不會變成出席，老師會以為記了）', async () => {
    const r = await checkIn(happy({ campuses: [{ id: A, attendance_mode: 'per_session' }] }));
    expect(r.status).toBe(409);
    expect(r.json?.code).toBe('NOT_DAILY_CHECKIN');
    expect(r.writes).toHaveLength(0);
  });

  it('分校沒設定 → 沿用機構預設（機構是隨堂就 409）', async () => {
    const r = await checkIn(happy({ campuses: [{ id: A, attendance_mode: null }] }));
    expect(r.status).toBe(409);
  });

  it('受限分校的管理員記範圍外的課 → 403，不寫', async () => {
    const r = await checkIn(happy(), ['admin'], [B]);
    expect(r.status).toBe(403);
    expect(r.writes).toHaveLength(0);
  });

  it('管理員不受「當天」限制（事後更正）', async () => {
    const r = await checkIn(
      happy({
        events: [
          { id: EVENT, event_date: '2026-04-05', campus_id: A, sessions: [{ class_id: CLASS }] },
        ],
      }),
      ['admin'],
    );
    expect(r.status).toBe(201);
  });
});

describe('GET /roster/{eventId} —— 分校範圍與到班時間', () => {
  const missing = { error: '找不到課堂' };

  it('受限分校的管理員讀範圍外課堂 → 404，body 跟不存在一字不差', async () => {
    const outOfScope = await call(happy(), {
      method: 'GET',
      path: `/roster/${EVENT}`,
      roles: ['admin'],
      scope: [B],
    });
    const notFound = await call(happy({ events: [] }), {
      method: 'GET',
      path: `/roster/${EVENT}`,
      roles: ['admin'],
      scope: [B],
    });
    expect(outOfScope.status).toBe(404);
    expect(outOfScope.json).toEqual(missing);
    expect(notFound.json).toEqual(outOfScope.json);
  });

  it('範圍內 → 200，帶出勤模式與每人的到班時間', async () => {
    const r = await call(
      happy({
        enrollments: [
          {
            student_id: STUDENT,
            effective_from: '2026-01-01',
            effective_to: null,
            students: { name: '王小明' },
          },
        ],
        daily_checkins: [
          { student_id: STUDENT, checked_in_at: '2026-04-06T08:12:00Z', campus_id: A },
        ],
      }),
      { method: 'GET', path: `/roster/${EVENT}`, roles: ['admin'], scope: [A] },
    );
    expect(r.status).toBe(200);
    expect(r.json?.attendanceMode).toBe('daily_checkin');
    expect(r.json?.students?.[0]?.checkedInAt).toBe('2026-04-06T08:12:00Z');
  });

  it('打卡指名了別的分校 → 不算到這堂（checkedInAt 是 null）', async () => {
    const r = await call(
      happy({
        enrollments: [{ student_id: STUDENT, effective_from: '2026-01-01', effective_to: null }],
        daily_checkins: [
          { student_id: STUDENT, checked_in_at: '2026-04-06T08:12:00Z', campus_id: B },
        ],
      }),
      { method: 'GET', path: `/roster/${EVENT}`, roles: ['admin'] },
    );
    expect(r.json?.students?.[0]?.checkedInAt).toBeNull();
  });
});

describe('annotateArrivals —— 課堂列表的模式與到班數', () => {
  const session = (over: Record<string, unknown> = {}) => ({
    classId: CLASS,
    campusId: A as string | null,
    eventDate: TODAY,
    ...over,
  });

  it('日到班：在籍且當天打卡的人數；隨堂：null', async () => {
    const db = fakeDb({
      organizations: [{ attendance_mode: 'per_session' }],
      campuses: [{ id: A, attendance_mode: 'daily_checkin' }],
      enrollments: [
        { student_id: 's1', class_id: CLASS, effective_from: '2026-01-01', effective_to: null },
        { student_id: 's2', class_id: CLASS, effective_from: '2026-01-01', effective_to: null },
        // 報名還沒生效 —— 打了卡也不算這班的人
        { student_id: 's3', class_id: CLASS, effective_from: '2026-05-01', effective_to: null },
      ],
      daily_checkins: [
        { student_id: 's1', checkin_date: TODAY, campus_id: A },
        { student_id: 's3', checkin_date: TODAY, campus_id: A },
        // 別天的卡
        { student_id: 's2', checkin_date: '2026-04-05', campus_id: A },
      ],
    });
    const r = await annotateArrivals(db as never, ORG, [session(), session({ campusId: B })]);
    expect(r.error).toBeNull();
    expect(r.data?.[0]).toMatchObject({ attendanceMode: 'daily_checkin', checkedInCount: 1 });
    // B 沒設定 → 機構預設隨堂
    expect(r.data?.[1]).toMatchObject({ attendanceMode: 'per_session', checkedInCount: null });
  });

  it('讀不到機構設定 → 回錯誤，不猜模式', async () => {
    const db = {
      from: (table: string) =>
        table === 'organizations'
          ? {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
                }),
              }),
            }
          : fakeDb({}).from(table),
    };
    const r = await annotateArrivals(db as never, ORG, [session()]);
    expect(r.error).toEqual({ message: 'boom' });
  });
});

describe('checkinCoversSession', () => {
  it('沒帶分校的卡算當天每一堂；帶了分校只算那個分校', () => {
    expect(checkinCoversSession(null, A)).toBe(true);
    expect(checkinCoversSession(A, A)).toBe(true);
    expect(checkinCoversSession(B, A)).toBe(false);
  });
});
