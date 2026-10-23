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

interface Failures {
  /** 清單讀取回 error（單筆讀取不受影響） */
  readonly failing?: readonly string[];
  /** `maybeSingle` 讀取回 error（出勤模式讀 organizations 走這條） */
  readonly failingSingle?: readonly string[];
  /** upsert 回 error */
  readonly failingWrites?: readonly string[];
}

function fakeDb(rows: Rows, failures: Failures | readonly string[] = {}) {
  const f: Failures = Array.isArray(failures) ? { failing: failures } : (failures as Failures);
  const failing = f.failing ?? [];
  const writes: Array<{ table: string; payload: unknown }> = [];
  const make = (table: string) => {
    const data = rows[table] ?? [];
    // `maybeSingle` 照 eq 條件挑列 —— 只比列上有的欄位（多數 fixture 只填了要測的那幾欄）
    const eqs: Array<[string, unknown]> = [];
    const picked = () => data.filter((r) => eqs.every(([c, v]) => !(c in r) || r[c] === v));
    const terminal = {
      eq: (c: string, v: unknown) => {
        eqs.push([c, v]);
        return builder;
      },
      maybeSingle: () =>
        Promise.resolve(
          f.failingSingle?.includes(table)
            ? { data: null, error: { message: `${table} 讀取失敗` } }
            : { data: picked()[0] ?? null, error: null },
        ),
      single: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      insert: (payload: unknown) => {
        writes.push({ table, payload });
        return Promise.resolve({ error: null });
      },
      upsert: (payload: unknown) => {
        writes.push({ table, payload });
        if (f.failingWrites?.includes(table)) {
          return { select: () => Promise.resolve({ data: null, error: { message: '寫入失敗' } }) };
        }
        // 已經有卡（UNIQUE student_id＋checkin_date 衝突）：ignoreDuplicates 回空陣列，lib 會回頭讀那一筆
        const day = (payload as Record<string, unknown>)['checkin_date'];
        if (
          table === 'daily_checkins' &&
          data.some((r) => !('checkin_date' in r) || r['checkin_date'] === day)
        ) {
          return { select: () => Promise.resolve({ data: [], error: null }) };
        }
        // 打卡 upsert 接 `.select()`：回剛寫入的那一列
        const row = { id: 'checkin-1', ...(payload as Record<string, unknown>) };
        return { select: () => Promise.resolve({ data: [row], error: null }) };
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(
          failing.includes(table)
            ? { data: null, error: { message: `${table} 讀取失敗` } }
            : { data, error: null },
        ).then(resolve),
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
  opts: {
    method: string;
    path: string;
    roles?: string[];
    scope?: string[] | null;
    failing?: string[];
    failingSingle?: string[];
    failingWrites?: string[];
  },
) {
  const db = fakeDb(rows, opts);
  const background: Promise<unknown>[] = [];
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
    {
      waitUntil: (p: Promise<unknown>) => background.push(p),
      passThroughOnException: () => undefined,
    } as never,
  );
  // 稽核走 waitUntil —— 等它寫完再斷言
  await Promise.all(background);
  return {
    status: res.status,
    json: (await res.json().catch(() => null)) as {
      error?: string;
      code?: string;
      attendanceMode?: string;
      alreadyCheckedIn?: boolean;
      checkedInAt?: string;
      checkInSource?: string | null;
      students?: Array<{ checkedInAt: string | null; checkInSource?: string | null }>;
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
      // #1100 #52：老師在名單上標的一律 manual，不收前端參數
      source: 'manual',
    });
    expect(r.json?.checkInSource).toBe('manual');
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

  it('報名讀取失敗 → 500，不當成「不在籍」', async () => {
    const r = await call(happy(), {
      method: 'POST',
      path: `/roster/${EVENT}/check-in`,
      failing: ['enrollments'],
    });
    expect(r.status).toBe(500);
    expect(r.writes).toHaveLength(0);
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

  // 計畫席 10-22 裁：卡已在別校，名單只認卡上的分校 —— 回 409、不寫出勤，免得三方不一致
  it('他今天已在別校掃過卡 → 409 CHECKED_IN_ELSEWHERE，打卡與出勤都沒有寫入', async () => {
    const r = await checkIn(
      happy({ daily_checkins: [{ campus_id: B, campuses: { name: '景美分校' } }] }),
    );
    expect(r.status).toBe(409);
    expect(r.json?.code).toBe('CHECKED_IN_ELSEWHERE');
    expect(r.json?.error).toContain('景美分校');
    // 擋在任何寫入之前：沒有打卡 upsert，也沒有 attendance_records
    expect(r.writes).toHaveLength(0);
  });

  // 審核席 E8：讀既有卡要限「當天」—— 前一天別校的卡不能擋今天
  it('前一天有別校的卡、今天沒有 → 照常 201，不擋', async () => {
    const r = await checkIn(
      happy({ daily_checkins: [{ campus_id: B, checkin_date: '2026-04-05' }] }),
    );
    expect(r.status).toBe(201);
    expect(r.json?.alreadyCheckedIn).toBe(false);
  });

  it('卡在同一校（或卡沒帶分校）→ 照常回 alreadyCheckedIn，時間是第一次那筆', async () => {
    for (const campus_id of [A, null]) {
      const r = await checkIn(
        happy({ daily_checkins: [{ campus_id, checked_in_at: '2026-04-06T01:00:00Z' }] }),
      );
      expect(r.status).toBe(201);
      expect(r.json).toMatchObject({
        alreadyCheckedIn: true,
        checkedInAt: '2026-04-06T01:00:00Z',
      });
    }
  });

  it('讀既有到班紀錄失敗 → 500，不寫', async () => {
    const r = await call(happy(), {
      method: 'POST',
      path: `/roster/${EVENT}/check-in`,
      failingSingle: ['daily_checkins'],
    });
    expect(r.status).toBe(500);
    expect(r.writes).toHaveLength(0);
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

  // #1100 #52：名單帶來源；這欄出現之前的舊紀錄是 null（只寫時間，不猜）
  it.each([
    ['scan', 'scan'],
    ['manual', 'manual'],
    [undefined, null],
  ])('打卡紀錄的 source=%s → checkInSource=%s', async (source, expected) => {
    const r = await call(
      happy({
        enrollments: [{ student_id: STUDENT, effective_from: '2026-01-01', effective_to: null }],
        daily_checkins: [
          {
            student_id: STUDENT,
            checked_in_at: '2026-04-06T08:12:00Z',
            campus_id: A,
            ...(source ? { source } : {}),
          },
        ],
      }),
      { method: 'GET', path: `/roster/${EVENT}`, roles: ['admin'], scope: [A] },
    );
    expect(r.json?.students?.[0]?.checkInSource).toBe(expected);
  });

  it('到班打卡或出勤紀錄讀取失敗 → 500，不退回「全部還沒到」', async () => {
    for (const table of ['daily_checkins', 'attendance_records']) {
      const r = await call(
        happy({
          enrollments: [{ student_id: STUDENT, effective_from: '2026-01-01', effective_to: null }],
        }),
        { method: 'GET', path: `/roster/${EVENT}`, roles: ['admin'], failing: [table] },
      );
      expect(r.status).toBe(500);
    }
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

/**
 * 審核席二讀（#1811 留言 6331085937）列出的存活突變，一條一條釘住。
 */
describe('讀寫失敗不能看起來正常', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${TODAY}T04:00:00Z`));
  });
  afterEach(() => vi.useRealTimers());

  it('roster 讀出勤模式失敗 → 500，不退回隨堂＋空名單', async () => {
    const r = await call(happy(), {
      method: 'GET',
      path: `/roster/${EVENT}`,
      roles: ['admin'],
      failingSingle: ['organizations'],
    });
    expect(r.status).toBe(500);
  });

  it('GET /sessions 讀出勤模式失敗 → 500', async () => {
    const r = await call(
      happy({
        sessions: [
          {
            id: 'sess-1',
            class_id: CLASS,
            event_id: EVENT,
            session_date: TODAY,
            status: 'scheduled',
            classes: { name: '班', campus_id: A },
            events: { id: EVENT, event_date: TODAY, campus_id: A },
          },
        ],
      }),
      {
        method: 'GET',
        path: `/sessions?dateFrom=${TODAY}&dateTo=${TODAY}`,
        roles: ['admin'],
        failingSingle: ['organizations'],
      },
    );
    expect(r.status).toBe(500);
  });

  it('check-in 寫入失敗 → 500，不回 201', async () => {
    const r = await call(happy(), {
      method: 'POST',
      path: `/roster/${EVENT}/check-in`,
      failingWrites: ['daily_checkins'],
    });
    expect(r.status).toBe(500);
  });

  it('check-in 的稽核標明是名單上記的（via: roster），分得出跟掃碼', async () => {
    const r = await call(happy(), { method: 'POST', path: `/roster/${EVENT}/check-in` });
    expect(r.status).toBe(201);
    const audit = r.writes.find((w) => w.table === 'audit_logs');
    expect(audit?.payload).toMatchObject({
      action: 'checkin',
      details: { via: 'roster', eventId: EVENT, studentId: STUDENT },
    });
  });
});

/** 會照 eq／in／gte／lte 過濾的替身 —— 到班數的計算靠查詢條件，固定回列的替身驗不出來 */
function filteringDb(rows: Rows, failing: readonly string[] = []) {
  const make = (table: string) => {
    const preds: Array<(r: Record<string, unknown>) => boolean> = [];
    const result = () =>
      failing.includes(table)
        ? { data: null, error: { message: `${table} 讀取失敗` } }
        : { data: (rows[table] ?? []).filter((r) => preds.every((p) => p(r))), error: null };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
      in: (c: string, v: unknown[]) => (preds.push((r) => v.includes(r[c])), q),
      gte: (c: string, v: string) => (preds.push((r) => String(r[c]) >= v), q),
      lte: (c: string, v: string) => (preds.push((r) => String(r[c]) <= v), q),
      maybeSingle: () => {
        const r = result();
        return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error });
      },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return q;
  };
  return { from: make };
}

describe('annotateArrivals —— 查詢條件與計數', () => {
  const C2 = '00000000-0000-0000-0000-0000000000e9';
  const base: Rows = {
    organizations: [{ id: ORG, attendance_mode: 'daily_checkin' }],
    campuses: [],
  };
  const enr = (student: string, klass = CLASS, over: Record<string, unknown> = {}) => ({
    org_id: ORG,
    student_id: student,
    class_id: klass,
    status: 'active',
    effective_from: '2026-01-01',
    effective_to: null,
    ...over,
  });
  const chk = (student: string, date = TODAY) => ({
    org_id: ORG,
    student_id: student,
    checkin_date: date,
    campus_id: A,
  });
  const sess = (over: Record<string, unknown> = {}) => ({
    classId: CLASS,
    campusId: A as string | null,
    eventDate: TODAY,
    ...over,
  });

  it('同一班兩筆在籍報名的學生只算一次', async () => {
    const db = filteringDb({
      ...base,
      enrollments: [enr('s1'), enr('s1', CLASS, { effective_from: '2026-02-01' })],
      daily_checkins: [chk('s1')],
    });
    const r = await annotateArrivals(db as never, ORG, [sess()]);
    expect(r.data?.[0]?.checkedInCount).toBe(1);
  });

  it('只算這一班的人：同頁另一班的到班不灌進來', async () => {
    const db = filteringDb({
      ...base,
      enrollments: [enr('s1'), enr('s2', C2)],
      daily_checkins: [chk('s1'), chk('s2')],
    });
    const r = await annotateArrivals(db as never, ORG, [sess(), sess({ classId: C2 })]);
    expect(r.data?.map((s) => s.checkedInCount)).toEqual([1, 1]);
  });

  it('跨日的頁面：最後一天的到班也算得到（日期上界是最晚那天）', async () => {
    const LATER = '2026-04-08';
    const db = filteringDb({
      ...base,
      enrollments: [enr('s1')],
      daily_checkins: [chk('s1', TODAY), chk('s1', LATER)],
    });
    const r = await annotateArrivals(db as never, ORG, [sess(), sess({ eventDate: LATER })]);
    expect(r.data?.map((s) => s.checkedInCount)).toEqual([1, 1]);
  });

  it('非 active 的報名（退班、暫停）不算進到班數', async () => {
    const db = filteringDb({
      ...base,
      enrollments: [enr('s1'), enr('s2', CLASS, { status: 'withdrawn' })],
      daily_checkins: [chk('s1'), chk('s2')],
    });
    const r = await annotateArrivals(db as never, ORG, [sess()]);
    expect(r.data?.[0]?.checkedInCount).toBe(1);
  });

  it('讀報名失敗 → 回錯誤，不退回 null 照常回', async () => {
    const db = filteringDb({ ...base, enrollments: [enr('s1')] }, ['enrollments']);
    const r = await annotateArrivals(db as never, ORG, [sess()]);
    expect(r.error).not.toBeNull();
  });

  it('讀到班打卡失敗 → 回錯誤，不退回 null 照常回', async () => {
    const db = filteringDb({ ...base, enrollments: [enr('s1')] }, ['daily_checkins']);
    const r = await annotateArrivals(db as never, ORG, [sess()]);
    expect(r.error).not.toBeNull();
  });
});
