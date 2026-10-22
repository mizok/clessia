import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../../lib/child-db';
import { createMultiOrgDb } from '../../test-utils/multi-org-db';

import attendanceRoute from './attendance';

/**
 * #1810：`GET /api/me/attendance/days` —— 課堂為來源、左接出勤，再把漏網的紀錄併回。
 * 用真的 `createChildDb` 包 `createMultiOrgDb`（會照條件過濾）：範圍、兄弟姊妹、日期窗都要真的有下。
 * 組列規則（在籍判準、推導、不變式）在 `lib/parent-attendance-days.spec.ts`。
 */

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const MINE = '00000000-0000-0000-0000-000000000001';
const SIBLING = '00000000-0000-0000-0000-000000000002';

const klass = (id: string, campus: string) => ({
  name: `班-${id}`,
  campus_id: campus,
  campuses: { name: campus === 'c-daily' ? '文山' : '景美' },
});

function session(id: string, classId: string, date: string, over: Record<string, unknown> = {}) {
  return {
    id,
    org_id: ORG,
    event_id: `ev-${id}`,
    session_date: date,
    start_time: '17:00:00',
    end_time: '18:30:00',
    status: 'scheduled',
    class_id: classId,
    teacher: { display_name: '王老師', org_id: ORG },
    schedules: { classrooms: { name: 'A 教室' } },
    classes: klass(classId, classId === 'cls-daily' ? 'c-daily' : 'c-session'),
    ...over,
  };
}

type Rows = Record<string, Array<Record<string, unknown>>>;

function seed(extra: Rows = {}) {
  const base: Rows = {
    organizations: [{ id: ORG, attendance_mode: 'per_session' }],
    campuses: [
      { id: 'c-daily', org_id: ORG, attendance_mode: 'daily_checkin' },
      { id: 'c-session', org_id: ORG, attendance_mode: null },
    ],
    classes: [
      { id: 'cls-daily', org_id: ORG, campus_id: 'c-daily' },
      { id: 'cls-session', org_id: ORG, campus_id: 'c-session' },
    ],
    enrollments: [
      {
        id: 'e1',
        org_id: ORG,
        student_id: MINE,
        class_id: 'cls-daily',
        status: 'active',
        effective_from: '2026-01-01',
        effective_to: null,
        status_changed_at: null,
      },
      {
        id: 'e2',
        org_id: ORG,
        student_id: MINE,
        class_id: 'cls-session',
        status: 'active',
        effective_from: '2026-01-01',
        effective_to: null,
        status_changed_at: null,
      },
      {
        id: 'e3',
        org_id: ORG,
        student_id: SIBLING,
        class_id: 'cls-sibling',
        status: 'active',
        effective_from: '2026-01-01',
        effective_to: null,
        status_changed_at: null,
      },
    ],
    sessions: [
      // 沒點名的堂（日到班分校，當天有刷卡 → 推導出席）
      session('s1', 'cls-daily', '2026-10-20'),
      // 有紀錄的堂
      session('s2', 'cls-session', '2026-10-21'),
      // 沒點名、隨堂分校、沒假 → 沒有紀錄
      session('s3', 'cls-session', '2026-10-22', {
        // 老師不屬於這個機構 → 不回名字
        teacher: { display_name: '別家的老師', org_id: OTHER_ORG },
        schedules: null,
      }),
      // 窗外
      session('s-out', 'cls-session', '2026-10-25'),
      // 兄弟姊妹的班
      session('s-sib', 'cls-sibling', '2026-10-21'),
    ],
    attendance_records: [
      {
        id: 'r2',
        org_id: ORG,
        student_id: MINE,
        event_id: 'ev-s2',
        status: 'absent',
        note: '沒來',
        recorded_by: 'teacher-user',
        recorded_by_role: 'teacher',
        created_at: '2026-10-21T10:00:00Z',
        updated_at: '2026-10-21T10:00:00Z',
        students: { name: '小明' },
        events: {
          event_date: '2026-10-21',
          start_time: '17:00:00',
          end_time: '18:30:00',
          campus_id: 'c-session',
          campuses: { name: '景美' },
          sessions: [
            {
              id: 's2',
              class_id: 'cls-session',
              status: 'completed',
              classes: { name: '班-cls-session' },
            },
          ],
        },
      },
      {
        // 非課堂事件（模擬考）：沒有 session，要併回
        id: 'r-mock',
        org_id: ORG,
        student_id: MINE,
        event_id: 'ev-mock',
        status: 'present',
        note: null,
        recorded_by: null,
        recorded_by_role: 'system',
        created_at: '2026-10-19T10:00:00Z',
        updated_at: '2026-10-19T10:00:00Z',
        students: { name: '小明' },
        events: {
          event_date: '2026-10-19',
          start_time: '09:00:00',
          end_time: '12:00:00',
          campus_id: 'c-session',
          campuses: { name: '景美' },
          sessions: [],
        },
      },
      {
        // 兄弟姊妹的紀錄：不能混進來
        id: 'r-sib',
        org_id: ORG,
        student_id: SIBLING,
        event_id: 'ev-s-sib',
        status: 'absent',
        note: null,
        recorded_by: null,
        recorded_by_role: 'teacher',
        created_at: '2026-10-21T10:00:00Z',
        updated_at: '2026-10-21T10:00:00Z',
        students: { name: '小華' },
        events: {
          event_date: '2026-10-21',
          start_time: '17:00:00',
          end_time: '18:30:00',
          campus_id: 'c-session',
          campuses: { name: '景美' },
          sessions: [],
        },
      },
    ],
    leave_requests: [],
    daily_checkins: [
      { id: 'k1', org_id: ORG, student_id: MINE, checkin_date: '2026-10-20', campus_id: 'c-daily' },
    ],
  };
  for (const [table, rows] of Object.entries(extra))
    base[table] = [...(base[table] ?? []), ...rows];
  return createMultiOrgDb(base as never);
}

function failing(): unknown {
  const result = { data: null, error: { message: 'boom' }, count: null };
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order']) q[m] = () => q;
  q['maybeSingle'] = () => Promise.resolve(result);
  q['then'] = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
  return q;
}

async function get(
  query: string,
  opts: {
    roles?: string[];
    scope?: readonly string[];
    failTable?: string;
    extra?: Rows;
    /** 記下每一支查詢的「表.方法(參數)」—— 被 lib 再過濾一次的條件，回應看不出來有沒有下 */
    log?: string[];
  } = {},
) {
  const db = seed(opts.extra);
  const scope = opts.scope ?? [MINE, SIBLING];
  if (opts.failTable) {
    const client = db.client as unknown as { from: (t: string) => unknown };
    const from = client.from.bind(client);
    client.from = (t: string) => (t === opts.failTable ? failing() : from(t));
  }
  if (opts.log) {
    const log = opts.log;
    const client = db.client as unknown as { from: (t: string) => unknown };
    const from = client.from.bind(client);
    const wrap = (target: object, table: string): unknown =>
      new Proxy(target, {
        get(t, prop) {
          const v = (t as Record<string | symbol, unknown>)[prop];
          if (typeof v !== 'function') return v;
          // then 要綁回原物件（真 Promise 有內部槽，Proxy 當 this 會炸）
          if (prop === 'then') return (v as (...a: unknown[]) => unknown).bind(t);
          return (...args: unknown[]) => {
            log.push(
              `${table}.${String(prop)}(${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(',')})`,
            );
            const r = (v as (...a: unknown[]) => unknown).apply(t, args);
            return r && typeof r === 'object' && !(r instanceof Promise)
              ? wrap(r as object, table)
              : r;
          };
        },
      });
    client.from = (t: string) => wrap(from(t) as object, t);
  }
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', opts.roles ?? ['parent']);
    set('studentScope', scope);
    set('childDb', createChildDb(db.client as never, scope, ORG));
    await next();
  });
  app.route('/', attendanceRoute as unknown as Hono);
  const res = await app.request(`/days?${query}`);
  return { status: res.status, body: (await res.json()) as any };
}

const WINDOW = `childId=${MINE}&dateFrom=2026-10-13&dateTo=2026-10-22`;

describe('GET /api/me/attendance/days（#1810）', () => {
  it('列出窗內這個孩子的每一堂（含沒點名的）＋併回非課堂紀錄；窗外、兄弟姊妹的不在', async () => {
    const { status, body } = await get(WINDOW);
    expect(status).toBe(200);
    expect(body.data.map((r: { id: string }) => r.id)).toEqual(['s3', 's2', 's1', 'r-mock']);
  });

  it('每一列的狀態：沒紀錄＝null（不是缺席）、有紀錄照紀錄、日到班當天刷卡＝derived checkin', async () => {
    const { body } = await get(WINDOW);
    const byId = Object.fromEntries(body.data.map((r: { id: string }) => [r.id, r]));
    expect(byId['s3']).toMatchObject({ status: null, derived: null });
    expect(byId['s2']).toMatchObject({ status: 'absent', note: '沒來', derived: null });
    expect(byId['s1']).toMatchObject({ status: null, derived: 'checkin' });
    expect(byId['r-mock']).toMatchObject({ status: 'present', sessionId: null });
  });

  it('老師與教室：同機構的老師回顯示名；別機構的老師、沒有時段的教室回 null', async () => {
    const { body } = await get(WINDOW);
    const byId = Object.fromEntries(body.data.map((r: { id: string }) => [r.id, r]));
    expect(byId['s1']).toMatchObject({ teacherName: '王老師', classroomName: 'A 教室' });
    expect(byId['s3']).toMatchObject({ teacherName: null, classroomName: null });
  });

  it('allowlist：不回經手人、角色、org、學生 id 等內部欄位', async () => {
    const { body } = await get(WINDOW);
    for (const row of body.data) {
      for (const k of [
        'recordedBy',
        'recorded_by',
        'recordedByRole',
        'orgId',
        'studentId',
        'teacherId',
      ]) {
        expect(row).not.toHaveProperty(k);
      }
    }
  });

  it('月度錨點：本月缺席與請假的筆數另外回', async () => {
    const { body } = await get(WINDOW);
    expect(body.meta).toHaveProperty('monthlyAbsentCount');
    expect(body.meta).toHaveProperty('monthlyOnLeaveCount');
  });

  it('區間：42 天放行；43 天或倒置 → 400 INVALID_RANGE', async () => {
    expect((await get(`childId=${MINE}&dateFrom=2026-09-10&dateTo=2026-10-22`)).status).toBe(200);
    const tooLong = await get(`childId=${MINE}&dateFrom=2026-09-09&dateTo=2026-10-22`);
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.code).toBe('INVALID_RANGE');
    expect((await get(`childId=${MINE}&dateFrom=2026-10-22&dateTo=2026-10-21`)).status).toBe(400);
  });

  it('不是家長 → 403；不在範圍內的孩子 → 403', async () => {
    expect((await get(WINDOW, { roles: ['admin'] })).status).toBe(403);
    const out = await get(WINDOW, { scope: [SIBLING] });
    expect(out.status).toBe(403);
    expect(out.body.code).toBe('CHILD_OUT_OF_SCOPE');
  });

  // 讀失敗不能變成 200＋少幾列：家長會把「沒列出來」讀成「那天沒課」
  it.each([
    'enrollments',
    'sessions',
    'attendance_records',
    'leave_requests',
    'daily_checkins',
    // 出勤模式：分校讀不到會退回機構預設（resolveAttendanceMode 的設計），機構讀不到才是錯
    'organizations',
  ])('讀 %s 失敗 → 500 FETCH_ATTENDANCE_FAILED', async (table) => {
    const { status, body } = await get(WINDOW, { failTable: table });
    expect(status).toBe(500);
    expect(body.code).toBe('FETCH_ATTENDANCE_FAILED');
  });
});

/** 審核席 #1818 二讀存活的突變（R5、R7–R10、R13、R14、R16、R17） */
describe('GET /api/me/attendance/days —— 審核席補強', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T04:00:00Z')); // 台北 10-22 中午：本月＝10 月
  });
  afterEach(() => vi.useRealTimers());

  // 兄弟姊妹的資料：任何一支查詢少了 .eq('student_id', childId)，就會混進 MINE 的回應
  const siblingData: Rows = {
    // 蓋到 MINE 10-22 那堂（s3）的整天假
    leave_requests: [
      {
        id: 'lv-sib',
        org_id: ORG,
        student_id: SIBLING,
        start_date: '2026-10-22',
        end_date: '2026-10-22',
        start_time: null,
        end_time: null,
        reason: '哥哥的假',
        submitted_by_role: 'parent',
        leave_request_sessions: [],
      },
    ],
    // MINE 10-18 有一堂日到班的課、自己沒刷卡；兄弟姊妹那天刷了
    sessions: [session('s4', 'cls-daily', '2026-10-18')],
    daily_checkins: [
      {
        id: 'k-sib',
        org_id: ORG,
        student_id: SIBLING,
        checkin_date: '2026-10-18',
        campus_id: 'c-daily',
      },
    ],
    attendance_records: [
      {
        id: 'r-sib-leave',
        org_id: ORG,
        student_id: SIBLING,
        event_id: 'ev-sib-2',
        status: 'on_leave',
        note: null,
        recorded_by: null,
        recorded_by_role: 'system',
        created_at: '2026-10-20T10:00:00Z',
        updated_at: '2026-10-20T10:00:00Z',
        students: { name: '小華' },
        events: {
          event_date: '2026-10-20',
          start_time: '17:00:00',
          end_time: '18:30:00',
          campus_id: 'c-session',
          campuses: { name: '景美' },
          sessions: [],
        },
      },
    ],
  };

  it('R7／R8：兄弟姊妹的假單與刷卡不會推導到這個孩子的堂', async () => {
    const { body } = await get(WINDOW, { extra: siblingData });
    const byId = Object.fromEntries(body.data.map((r: { id: string }) => [r.id, r]));
    expect(byId['s3']).toMatchObject({ status: null, derived: null, leaveSubmittedBy: null });
    expect(byId['s4']).toMatchObject({ status: null, derived: null });
  });

  it('R9／R10：本月缺席與請假只算這個孩子的', async () => {
    const { body } = await get(WINDOW, { extra: siblingData });
    // MINE 本月：缺席 1（r2）、請假 0；兄弟姊妹的缺席 r-sib、請假 r-sib-leave 都不能算進來
    expect(body.meta).toEqual({ monthlyAbsentCount: 1, monthlyOnLeaveCount: 0 });
  });

  it('R5／R14／R16／R17：每一支查詢都下了窗的上下界（lib 會再過濾，回應看不出來）', async () => {
    const log: string[] = [];
    await get(WINDOW, { log });
    for (const expected of [
      'sessions.gte(session_date,2026-10-13)',
      'sessions.lte(session_date,2026-10-22)',
      'attendance_records.gte(events.event_date,2026-10-13)',
      'attendance_records.lte(events.event_date,2026-10-22)',
      'leave_requests.lte(start_date,2026-10-22)',
      'leave_requests.gte(end_date,2026-10-13)',
      'daily_checkins.gte(checkin_date,2026-10-13)',
      'daily_checkins.lte(checkin_date,2026-10-22)',
    ]) {
      expect(log, expected).toContain(expected);
    }
  });

  it('R13：暫停的報名 —— 暫停那天之前的堂照列，之後的不列（status_changed_at 有接上）', async () => {
    const extra: Rows = {
      enrollments: [
        {
          id: 'e-susp',
          org_id: ORG,
          student_id: MINE,
          class_id: 'cls-susp',
          status: 'suspended',
          effective_from: '2026-01-01',
          effective_to: null,
          status_changed_at: '2026-10-18',
        },
      ],
      sessions: [
        session('susp-before', 'cls-susp', '2026-10-16'),
        session('susp-after', 'cls-susp', '2026-10-20'),
      ],
    };
    const { body } = await get(WINDOW, { extra });
    const ids = body.data.map((r: { id: string }) => r.id);
    expect(ids).toContain('susp-before');
    expect(ids).not.toContain('susp-after');
  });
});
