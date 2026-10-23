import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { notifyLeaveStreaks } from '../lib/leave-streak';
import { notifyLeaveForTeachers } from '../lib/notify-leave';
import { createMultiOrgDb } from '../test-utils/multi-org-db';
import { restBackedLeavePool } from '../test-utils/rest-backed-leave-pool';
import leavesApp from './leaves';

// #1693：老師的請假通知 —— 通知的堂要跟寫成 on_leave 的堂同一份（收件人由 notify-leave.spec 守）
vi.mock('../lib/notify-leave', () => ({ notifyLeaveForTeachers: vi.fn(async () => undefined) }));
const noticed = vi.mocked(notifyLeaveForTeachers);
const noticedSessions = () => [...(noticed.mock.calls[0]?.[1].sessionIds ?? [])].sort();
afterEach(() => noticed.mockClear());

// #1732：連續請假偵測 —— 建立與改長才跑，改短、只改事由不跑（演算法由 leave-streak.spec 守）
vi.mock('../lib/leave-streak', () => ({ notifyLeaveStreaks: vi.fn(async () => undefined) }));
const streakChecked = vi.mocked(notifyLeaveStreaks);
afterEach(() => streakChecked.mockClear());

/**
 * #1114 請假綁定堂次。設計：kb/wiki/architecture/leave-session-binding.md。
 *
 * 用會照條件過濾的 multi-org-db：要證明的是「只有綁定那幾堂被寫成 on_leave、別 org 的堂綁不上」，
 * 回固定資料的替身證明不了。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const STU = id(1);
const CLS = id(11);
const CLS_LATE = id(12); // 學生 10/10 才加入
const D = '2026-10-06';
const D2 = '2026-10-08';

const S_AM = id(101);
const S_PM = id(102);
const S_CANCELLED = id(103);
const S_D2 = id(104);
const S_OTHER_ORG = id(105);
const S_LATE = id(106);
const EV_AM = id(201);
const EV_PM = id(202);
const EV_D2 = id(204);
const EV_LATE = id(206);

function session(sid: string, date: string, start: string, end: string, extra: object = {}) {
  return {
    id: sid,
    org_id: ORG,
    class_id: CLS,
    session_date: date,
    start_time: `${start}:00`,
    end_time: `${end}:00`,
    status: 'scheduled',
    ...extra,
  };
}

function event(eid: string, s: ReturnType<typeof session>, extra: object = {}) {
  return {
    id: eid,
    org_id: s.org_id,
    event_type: 'session',
    event_date: s.session_date,
    start_time: s.start_time,
    end_time: s.end_time,
    attendance_taken_at: null,
    sessions: { id: s.id, class_id: s.class_id, status: s.status },
    ...extra,
  };
}

function seed(
  extra: Record<string, Record<string, unknown>[]> = {},
  opts: { amTaken?: boolean } = {},
) {
  const am = session(S_AM, D, '09', '11');
  const pm = session(S_PM, D, '14', '16');
  const d2 = session(S_D2, D2, '09', '11');
  const late = session(S_LATE, '2026-10-06', '18', '20', { class_id: CLS_LATE });
  return createMultiOrgDb({
    students: [{ id: STU, org_id: ORG, name: '王小明' }],
    enrollments: [
      {
        org_id: ORG,
        student_id: STU,
        class_id: CLS,
        status: 'active',
        effective_from: '2026-01-01',
        effective_to: null,
      },
      {
        org_id: ORG,
        student_id: STU,
        class_id: CLS_LATE,
        status: 'active',
        effective_from: '2026-10-10',
        effective_to: null,
      },
    ],
    sessions: [
      am,
      pm,
      d2,
      late,
      session(S_CANCELLED, D, '18', '19', { status: 'cancelled' }),
      session(S_OTHER_ORG, D, '09', '11', { org_id: ORG_B }),
    ],
    events: [
      event(EV_AM, am, opts.amTaken ? { attendance_taken_at: '2026-10-06T10:00:00Z' } : {}),
      event(EV_PM, pm),
      event(EV_D2, d2),
      event(EV_LATE, late),
    ],
    leave_requests: [],
    leave_request_sessions: [],
    attendance_records: [],
    audit_logs: [],
    profiles: [],
    ...extra,
  });
}

/**
 * multi-org-db 刻意不做巢狀關聯，而路由讀假單時靠 embed `leave_request_sessions(session_id, sessions(session_date))`
 * 拿綁定。讀 `leave_requests` 時從替身自己的表補上那段 embed —— 少了它，綁定型的假讀回來會變成整天型。
 *
 * **只在 select 字串真的有要那段 embed 時才補**。原本無條件補，於是 `select('*, …')`
 * 的列表與 PATCH 回應在替身裡照樣有綁定，真的 PostgREST 卻回 `sessionIds: []` ——
 * #1150 本機實打才抓到。替身比 DB 慷慨，測試就驗不到 select 寫錯。
 */
function withLeaveEmbed(db: ReturnType<typeof createMultiOrgDb>) {
  type Row = Record<string, unknown>;
  const embed = (row: Row): Row => ({
    ...row,
    leave_request_sessions: db
      .rows('leave_request_sessions')
      .filter((b) => b['leave_request_id'] === row['id'])
      .map((b) => ({
        session_id: b['session_id'],
        sessions: {
          session_date: db.rows('sessions').find((s) => s['id'] === b['session_id'])?.[
            'session_date'
          ],
        },
      })),
  });
  const augment = (r: { data: unknown }) => ({
    ...r,
    data: Array.isArray(r.data) ? r.data.map(embed) : r.data ? embed(r.data as Row) : r.data,
  });
  const wrap = (b: any, wantsEmbed = false): any =>
    new Proxy(b, {
      get(target, prop) {
        const fix = (r: { data: unknown }) => (wantsEmbed ? augment(r) : r);
        if (prop === 'then')
          return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
            target.then((r: { data: unknown }) => ok(fix(r)), ko);
        if (prop === 'single' || prop === 'maybeSingle') return () => target[prop]().then(fix);
        const value = target[prop];
        return typeof value === 'function'
          ? (...args: unknown[]) =>
              wrap(
                value.apply(target, args),
                wantsEmbed ||
                  (prop === 'select' && String(args[0] ?? '').includes('leave_request_sessions(')),
              )
          : value;
      },
    });
  const client = db.client as { from: (t: string) => unknown };
  return {
    from: (table: string) =>
      table === 'leave_requests' ? wrap(client.from(table)) : client.from(table),
  };
}

function appWith(
  db: ReturnType<typeof createMultiOrgDb>,
  opts: { pool?: unknown; supabase?: unknown } = {},
) {
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    const client = withLeaveEmbed(db);
    set('supabase', opts.supabase ?? client);
    if (opts.pool !== null) set('auth', { pool: opts.pool ?? restBackedLeavePool(client) });
    set('orgId', ORG);
    set('campusScope', null);
    set('userId', 'user-1');
    set('roles', ['admin']);
    await next();
  });
  app.route('/api/leaves', leavesApp);
  return app;
}

const post = (app: Hono, body: Record<string, unknown>) =>
  app.request('/api/leaves', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId: STU, startDate: D, endDate: D, ...body }),
  });

const onLeaveEvents = (db: ReturnType<typeof createMultiOrgDb>) =>
  db
    .rows('attendance_records')
    .filter((r) => r['status'] === 'on_leave')
    .map((r) => r['event_id'])
    .sort();

describe('POST /api/leaves —— sessionIds', () => {
  it('寫入假單＋綁定列，start_date／end_date 由綁定堂次算出、不吃 body', async () => {
    const db = seed();
    const res = await post(appWith(db), {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      sessionIds: [S_D2, S_AM],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { sessionIds: string[]; startDate: string; endDate: string };
    expect(body).toMatchObject({ startDate: D, endDate: D2 });
    expect([...body.sessionIds].sort()).toEqual([S_AM, S_D2].sort());

    const [leave] = db.rows('leave_requests');
    expect(leave).toMatchObject({ start_date: D, end_date: D2 });
    expect(
      db
        .rows('leave_request_sessions')
        .map((r) => [r['session_id'], r['org_id'], r['leave_request_id']])
        .sort(),
    ).toEqual(
      [
        [S_AM, ORG, leave?.['id']],
        [S_D2, ORG, leave?.['id']],
      ].sort(),
    );
  });

  it('只對綁定的堂寫 on_leave，同日其他堂不動', async () => {
    const db = seed();
    expect((await post(appWith(db), { sessionIds: [S_AM] })).status).toBe(201);
    expect(onLeaveEvents(db)).toEqual([EV_AM]);
    expect(noticed).toHaveBeenCalledTimes(1);
    expect(noticed.mock.calls[0]![1]).toMatchObject({
      orgId: ORG,
      actorUserId: 'user-1',
      leaveId: db.rows('leave_requests')[0]!['id'],
    });
    expect(noticedSessions()).toEqual([S_AM]);
  });

  it('別 org 的堂：400，不寫任何列（c1）', async () => {
    const db = seed();
    const res = await post(appWith(db), { sessionIds: [S_AM, S_OTHER_ORG] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { sessionId: string }).sessionId).toBe(S_OTHER_ORG);
    expect(db.rows('leave_requests')).toHaveLength(0);
    expect(db.rows('leave_request_sessions')).toHaveLength(0);
    expect(noticed).not.toHaveBeenCalled();
  });

  it('學生那天不在籍的堂、停課的堂：400 並指名哪一堂', async () => {
    const db = seed();
    const late = await post(appWith(db), { sessionIds: [S_LATE] });
    expect(late.status).toBe(400);
    expect(((await late.json()) as { code: string; sessionId: string }).sessionId).toBe(S_LATE);

    const cancelled = await post(appWith(db), { sessionIds: [S_CANCELLED] });
    expect(cancelled.status).toBe(400);
    expect(((await cancelled.json()) as { sessionId: string }).sessionId).toBe(S_CANCELLED);
    expect(db.rows('leave_requests')).toHaveLength(0);
  });

  it('sessionIds 與 startTime／endTime 同時給：400', async () => {
    const db = seed();
    const res = await post(appWith(db), {
      sessionIds: [S_AM],
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/leaves —— 單日時間窗假只寫重疊的堂（順帶修）', () => {
  // 修之前 applyLeaveAttendance 完全不看時間：roster 推導（leaveCoversSession）說只蓋下午那堂，
  // 出勤紀錄卻把早上那堂也寫成 on_leave。
  it('沒綁定、單日 13:00～17:00：只有下午那堂 on_leave', async () => {
    const db = seed();
    const res = await post(appWith(db), { startTime: '13:00', endTime: '17:00' });
    expect(res.status).toBe(201);
    expect(onLeaveEvents(db)).toEqual([EV_PM]);
    expect(noticedSessions()).toEqual([S_PM]);
  });

  it('沒綁定、沒時間：當天全部在籍的堂照舊都寫', async () => {
    const db = seed();
    expect((await post(appWith(db), {})).status).toBe(201);
    expect(onLeaveEvents(db)).toEqual([EV_AM, EV_PM].sort());
    expect(noticedSessions()).toEqual([S_AM, S_PM].sort());
  });
});

describe('POST /api/leaves —— 重疊（裁定 4）', () => {
  it('綁定型之間：不同堂可以並存，同一堂 409', async () => {
    const db = seed();
    const app = appWith(db);
    expect((await post(app, { sessionIds: [S_AM] })).status).toBe(201);
    expect((await post(app, { sessionIds: [S_PM] })).status).toBe(201);
    expect((await post(app, { sessionIds: [S_PM, S_D2] })).status).toBe(409);
  });

  it('綁定型與整天型同日：409（兩個方向）', async () => {
    const db = seed();
    const app = appWith(db);
    expect((await post(app, { sessionIds: [S_AM] })).status).toBe(201);
    expect((await post(app, {})).status).toBe(409);

    const db2 = seed();
    const app2 = appWith(db2);
    expect((await post(app2, {})).status).toBe(201);
    expect((await post(app2, { sessionIds: [S_PM] })).status).toBe(409);
  });

  it('綁定型區間中間的空日，整天型可以請', async () => {
    const db = seed();
    const app = appWith(db);
    expect((await post(app, { sessionIds: [S_AM, S_D2] })).status).toBe(201);
    expect((await post(app, { startDate: '2026-10-07', endDate: '2026-10-07' })).status).toBe(201);
  });
});

describe('GET /api/leaves —— 列表帶綁定', () => {
  it('綁定型的假在列表裡回 sessionIds（select 漏 embed 會變成 []，#1150 實打）', async () => {
    const db = seed();
    expect((await post(appWith(db), { sessionIds: [S_AM, S_D2] })).status).toBe(201);

    const res = await appWith(db).request('/api/leaves');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ sessionIds: string[] }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.sessionIds.sort()).toEqual([S_AM, S_D2].sort());
  });
});

describe('PATCH /api/leaves/:id —— 綁定替換', () => {
  async function created(db: ReturnType<typeof createMultiOrgDb>, sessionIds: string[]) {
    const res = await post(appWith(db), { sessionIds });
    return ((await res.json()) as { id: string }).id;
  }
  const patch = (db: ReturnType<typeof createMultiOrgDb>, leaveId: string, body: object) =>
    appWith(db).request(`/api/leaves/${leaveId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('新增的堂 apply on_leave、拿掉的堂 revert；區間跟著綁定重算', async () => {
    const db = seed();
    const leaveId = await created(db, [S_AM]);
    const res = await patch(db, leaveId, { sessionIds: [S_PM, S_D2] });
    expect(res.status).toBe(200);
    expect(onLeaveEvents(db)).toEqual([EV_PM, EV_D2].sort());
    expect(
      db
        .rows('leave_request_sessions')
        .map((r) => r['session_id'])
        .sort(),
    ).toEqual([S_PM, S_D2].sort());
    expect(db.rows('leave_requests')[0]).toMatchObject({ start_date: D, end_date: D2 });
  });

  it('拿掉的堂若已點名（attendance_taken_at 有值）：on_leave 不動', async () => {
    const db = seed({}, { amTaken: true });
    const leaveId = await created(db, [S_AM]);
    expect((await patch(db, leaveId, { sessionIds: [S_PM] })).status).toBe(200);
    expect(onLeaveEvents(db)).toEqual([EV_AM, EV_PM].sort());
  });

  it('沒給 sessionIds：綁定不變；綁定型的假不能直接改日期（400）', async () => {
    const db = seed();
    const leaveId = await created(db, [S_AM]);
    const res = await patch(db, leaveId, { reason: '發燒' });
    expect(res.status).toBe(200);
    expect(db.rows('leave_request_sessions')).toHaveLength(1);
    // 回應也要帶綁定 —— select 漏了 embed 時真的 PostgREST 回 []（#1150 實打）
    expect(((await res.json()) as { sessionIds: string[] }).sessionIds).toEqual([S_AM]);
    expect((await patch(db, leaveId, { endDate: D2 })).status).toBe(400);
  });

  it('換到別人已綁的堂：409', async () => {
    const db = seed();
    const first = await created(db, [S_AM]);
    const second = await created(db, [S_PM]);
    expect(first).not.toBe(second);
    expect((await patch(db, second, { sessionIds: [S_AM] })).status).toBe(409);
  });
});

describe('PATCH /api/leaves/:id —— 老師通知只發新增的堂（#1693，計畫席 10-16 裁）', () => {
  const patch = (db: ReturnType<typeof createMultiOrgDb>, leaveId: string, body: object) =>
    appWith(db).request(`/api/leaves/${leaveId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const create = async (db: ReturnType<typeof createMultiOrgDb>, body: Record<string, unknown>) => {
    const res = await post(appWith(db), body);
    expect(res.status).toBe(201);
    noticed.mockClear();
    return ((await res.json()) as { id: string }).id;
  };

  it('綁定型換堂：保留的、拿掉的都不通知，只通知新增的', async () => {
    const db = seed();
    const leaveId = await create(db, { sessionIds: [S_AM, S_PM] });
    expect((await patch(db, leaveId, { sessionIds: [S_AM, S_D2] })).status).toBe(200);
    expect(noticed.mock.calls[0]![1]).toMatchObject({ leaveId, actorUserId: 'user-1' });
    expect(noticedSessions()).toEqual([S_D2]);
  });

  it('日期區間型延長一天：只通知新增那天的堂', async () => {
    const db = seed();
    const leaveId = await create(db, {});
    expect((await patch(db, leaveId, { endDate: D2 })).status).toBe(200);
    expect(noticedSessions()).toEqual([S_D2]);
  });

  it('日期區間型改成綁定堂次：舊區間裡的日子不再通知，只通知區間外的', async () => {
    const db = seed();
    const leaveId = await create(db, {});
    expect((await patch(db, leaveId, { sessionIds: [S_PM, S_D2] })).status).toBe(200);
    expect(noticedSessions()).toEqual([S_D2]);
  });

  it('只改事由：沒有新增的堂，不通知', async () => {
    const db = seed();
    const leaveId = await create(db, { sessionIds: [S_AM] });
    expect((await patch(db, leaveId, { reason: '發燒' })).status).toBe(200);
    expect(noticedSessions()).toEqual([]);
  });
});

describe('POST／PATCH /api/leaves —— 連續請假偵測（#1732）', () => {
  const patch = (db: ReturnType<typeof createMultiOrgDb>, leaveId: string, body: object) =>
    appWith(db).request(`/api/leaves/${leaveId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const create = async (db: ReturnType<typeof createMultiOrgDb>, body: Record<string, unknown>) => {
    const res = await post(appWith(db), body);
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };

  it('建立：以假單的日期區間偵測', async () => {
    const db = seed();
    await create(db, {});
    expect(streakChecked).toHaveBeenCalledTimes(1);
    expect(streakChecked.mock.calls[0]![1]).toMatchObject({ orgId: ORG, from: D, to: D });
  });

  it('日期區間型延長：用新的區間再偵測一次', async () => {
    const db = seed();
    const leaveId = await create(db, {});
    streakChecked.mockClear();
    expect((await patch(db, leaveId, { endDate: D2 })).status).toBe(200);
    expect(streakChecked.mock.calls[0]![1]).toMatchObject({ from: D, to: D2 });
  });

  it('改短、只改事由：不偵測（不重發）', async () => {
    const db = seed();
    const leaveId = await create(db, { endDate: D2 });
    streakChecked.mockClear();
    expect((await patch(db, leaveId, { endDate: D })).status).toBe(200);
    expect((await patch(db, leaveId, { reason: '發燒' })).status).toBe(200);
    expect(streakChecked).not.toHaveBeenCalled();
  });

  it('綁定型加堂：偵測；只拿掉堂：不偵測', async () => {
    const db = seed();
    const leaveId = await create(db, { sessionIds: [S_AM] });
    streakChecked.mockClear();
    expect((await patch(db, leaveId, { sessionIds: [S_AM, S_D2] })).status).toBe(200);
    expect(streakChecked).toHaveBeenCalledTimes(1);
    streakChecked.mockClear();
    expect((await patch(db, leaveId, { sessionIds: [S_AM] })).status).toBe(200);
    expect(streakChecked).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/leaves/:id —— 綁定型', () => {
  it('full：revert 只回綁定的堂，同日別堂的 on_leave 不動', async () => {
    const db = seed({
      // 同日另一堂本來就有一筆別的 on_leave（例如別張整天假時代留下的）—— 不該被這張的刪除帶走
      attendance_records: [{ org_id: ORG, student_id: STU, event_id: EV_PM, status: 'on_leave' }],
    });
    const res = await post(appWith(db), { sessionIds: [S_D2] });
    const leaveId = ((await res.json()) as { id: string }).id;
    expect(onLeaveEvents(db)).toEqual([EV_PM, EV_D2].sort());

    const del = await appWith(db).request(`/api/leaves/${leaveId}?mode=full`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);
    // 綁定列由 FK 的 ON DELETE CASCADE 收（migration），替身不模擬 FK
    expect(onLeaveEvents(db)).toEqual([EV_PM]);
  });
});

describe('DELETE /api/leaves/:id?mode=truncate —— 進行中的綁定型', () => {
  afterEach(() => vi.useRealTimers());

  it('拆掉今天起的綁定、區間收到剩下最後一堂；只 revert 被拆掉的堂', async () => {
    const db = seed();
    const res = await post(appWith(db), { sessionIds: [S_AM, S_D2] });
    const leaveId = ((await res.json()) as { id: string }).id;
    expect(onLeaveEvents(db)).toEqual([EV_AM, EV_D2].sort());

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T04:00:00Z')); // 台北 10/07 中午

    const del = await appWith(db).request(`/api/leaves/${leaveId}?mode=truncate`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);
    expect(db.rows('leave_request_sessions').map((r) => r['session_id'])).toEqual([S_AM]);
    expect(db.rows('leave_requests')[0]).toMatchObject({ start_date: D, end_date: D });
    expect(onLeaveEvents(db)).toEqual([EV_AM]);
  });
});

describe('POST /api/leaves —— 取鎖、查重疊、寫入同一筆交易（#1957）', () => {
  it('沒有 pg pool → 500，不退回沒有交易的寫法、什麼都沒寫', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = seed();
    const res = await post(appWith(db, { pool: null }), { sessionIds: [S_AM] });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe('POOL_UNAVAILABLE');
    expect(db.rows('leave_requests')).toEqual([]);
  });

  it('先取這位學生的鎖，再查重疊、再寫 —— 順序都在 BEGIN 與 COMMIT 之間', async () => {
    const db = seed();
    const pool = restBackedLeavePool(withLeaveEmbed(db));
    const res = await post(appWith(db, { pool }), { sessionIds: [S_AM] });
    expect(res.status).toBe(201);
    const order = pool.statements.map((s) =>
      s.includes('BEGIN')
        ? 'BEGIN'
        : s.includes('COMMIT')
          ? 'COMMIT'
          : s.includes('pg_advisory_xact_lock')
            ? 'lock'
            : s.includes('select l.id')
              ? 'overlap'
              : s.includes('with l as')
                ? 'insert'
                : s.includes('insert into public.leave_request_sessions')
                  ? 'bind'
                  : s,
    );
    expect(order).toEqual(['BEGIN', 'lock', 'overlap', 'insert', 'bind', 'COMMIT']);
  });

  it('綁定寫不上 → 整筆 ROLLBACK、500（不會留一張整天語意的假）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = seed();
    const base = restBackedLeavePool(withLeaveEmbed(db));
    const pool = {
      ...base,
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes('insert into public.leave_request_sessions')) throw new Error('boom');
        return base.query(sql, params);
      },
    };
    pool.connect = async () => ({ query: pool.query, release: () => undefined });
    const res = await post(appWith(db, { pool }), { sessionIds: [S_AM] });
    expect(res.status).toBe(500);
    expect(base.statements).toContain('ROLLBACK');
    expect(base.statements).not.toContain('COMMIT');
  });

  it('subrequest 預算：綁一堂的單筆 POST，supabase-js 呼叫數比改寫前少（Workers 上限 50，#1954 守 ≤45）', async () => {
    const db = seed();
    const client = withLeaveEmbed(db);
    let calls = 0;
    const counted = {
      from: (t: string) => {
        calls += 1;
        return client.from(t);
      },
    };
    const waits: Promise<unknown>[] = [];
    const res = await appWith(db, { supabase: counted, pool: restBackedLeavePool(client) }).request(
      '/api/leaves',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentId: STU, startDate: D, endDate: D, sessionIds: [S_AM] }),
      },
      {},
      {
        waitUntil: (p: Promise<unknown>) => waits.push(p),
        passThroughOnException: () => undefined,
      } as never,
    );
    await Promise.allSettled(waits);
    expect(res.status).toBe(201);
    expect(calls).toBeGreaterThan(5);
    // 10-23 量測：改寫前（main @f2d59777）這個情境 13 次，查重疊、寫假單、寫綁定改走 pool 後 10 次
    expect(calls).toBeLessThanOrEqual(10);
  });
});
