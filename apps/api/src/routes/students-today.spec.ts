import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyToday, type DailyAttendance } from '../lib/today-attendance';
import { createMultiOrgDb } from '../test-utils/multi-org-db';
import studentsRoute from './students';

/**
 * #1314 SL1：學生名冊的今日到班。判準跟作業台同一份（`lib/today-attendance.ts`）。
 * 時間用假時鐘釘在 2026-03-10 10:00（台北）—— 「開始了沒」不能跟著跑測試的時刻變（#670 那一族）。
 */

const DATE = '2026-03-10';
const NOW = new Date(`${DATE}T10:00:00+08:00`);

describe('classifyToday', () => {
  const daily = (over: Partial<DailyAttendance> = {}): DailyAttendance => ({
    expected: [
      {
        studentId: 'early',
        studentName: '',
        grade: null,
        campusId: null,
        campusName: null,
        firstSession: { startTime: '09:00', className: 'A' },
      },
      {
        studentId: 'late',
        studentName: '',
        grade: null,
        campusId: null,
        campusName: null,
        firstSession: { startTime: '15:00', className: 'B' },
      },
      {
        studentId: 'notime',
        studentName: '',
        grade: null,
        campusId: null,
        campusName: null,
        firstSession: null,
      },
    ],
    arrived: [],
    onLeave: [],
    ...over,
  });
  const states = (d: DailyAttendance) =>
    Object.fromEntries([...classifyToday(d, DATE, NOW)].map(([id, s]) => [id, s.state]));

  it('開始了沒到 → missing；還沒開始 → not_yet；沒有時間當還沒開始', () => {
    expect(states(daily())).toEqual({ early: 'missing', late: 'not_yet', notime: 'not_yet' });
  });

  it('打卡優先於請假，請假優先於該到沒到', () => {
    const d = daily({
      arrived: [{ studentId: 'early', checkedInAt: `${DATE}T00:55:00Z`, checkinId: 'c1' }],
      onLeave: [
        {
          studentId: 'early',
          studentName: '',
          startDate: DATE,
          endDate: DATE,
          submittedByRole: 'parent',
          reason: null,
        },
        {
          studentId: 'late',
          studentName: '',
          startDate: DATE,
          endDate: DATE,
          submittedByRole: 'parent',
          reason: null,
        },
      ],
    });
    const result = classifyToday(d, DATE, NOW);
    expect(result.get('early')).toEqual({
      state: 'arrived',
      dueAt: '09:00',
      arrivedAt: `${DATE}T00:55:00Z`,
    });
    expect(result.get('late')?.state).toBe('on_leave');
  });
});

const ORG = 'org-a';
const student = (id: string, grade = 'J1') => ({
  id,
  org_id: ORG,
  name: id,
  grade,
  is_active: true,
});
const enrollment = (studentId: string, classId: string) => ({
  org_id: ORG,
  student_id: studentId,
  class_id: classId,
  status: 'active',
  effective_from: '2026-01-01',
  effective_to: null,
  students: { name: studentId, grade: 'J1' },
});
const session = (classId: string, start: string, campusId = 'campus-1') => ({
  org_id: ORG,
  session_date: DATE,
  class_id: classId,
  start_time: `${start}:00`,
  events: null,
  classes: { name: classId, campus_id: campusId, campuses: { name: '本校' } },
});

function seed(mode: 'daily_checkin' | 'per_session' = 'daily_checkin') {
  return createMultiOrgDb({
    organizations: [{ id: ORG, attendance_mode: mode }],
    campuses: [],
    students: [
      student('s-arrived'),
      student('s-missing', 'J2'),
      student('s-notyet'),
      student('s-leave'),
      student('s-none'),
    ],
    sessions: [
      session('c-am', '09:00'),
      session('c-pm', '15:00', 'campus-2'),
      // 停課：s-none 只有這堂 → 今天不必來（A6 排除，計畫席 10-10 裁）
      { ...session('c-off', '08:00'), status: 'cancelled' },
    ],
    enrollments: [
      enrollment('s-arrived', 'c-am'),
      enrollment('s-missing', 'c-am'),
      enrollment('s-leave', 'c-am'),
      enrollment('s-notyet', 'c-pm'),
      enrollment('s-none', 'c-off'),
      // s-notyet 也上老師的 c-tue（今天沒課）—— 老師的學生，但今天只有別班 c-pm 的課（#1100 #51）
      enrollment('s-notyet', 'c-tue'),
    ],
    daily_checkins: [
      {
        id: 'k1',
        org_id: ORG,
        student_id: 's-arrived',
        checkin_date: DATE,
        checked_in_at: `${DATE}T00:50:00Z`,
      },
    ],
    leave_requests: [
      {
        org_id: ORG,
        student_id: 's-leave',
        start_date: DATE,
        end_date: DATE,
        start_time: null,
        end_time: null,
        submitted_by_role: 'parent',
        reason: '發燒',
        leave_request_sessions: [],
      },
    ],
    parent_student_relations: [],
    // 老師 staff-t 固定任課 c-am（s-arrived／s-missing／s-leave）與 c-tue（s-notyet，今天沒課）
    staff: [{ id: 'staff-t', user_id: 'u-teacher', org_id: ORG }],
    schedules: [
      { class_id: 'c-am', teacher_id: 'staff-t', classes: { org_id: ORG } },
      { class_id: 'c-tue', teacher_id: 'staff-t', classes: { org_id: ORG } },
    ],
  });
}

async function list(
  query: string,
  opts: {
    mode?: 'daily_checkin' | 'per_session';
    campusScope?: string[] | null;
    teacher?: boolean;
    /** 依序記下每次 `from(table)`，用來看查詢發出的先後 */
    calls?: string[];
    /** 這張表的查詢一律回 error（看錯誤路徑） */
    failTable?: string;
  } = {},
) {
  const db = seed(opts.mode);
  const calls = opts.calls ?? [];
  const failing = () => {
    const chain: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ data: null, error: { message: `${opts.failTable} 壞了` } }),
    };
    for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'range', 'or', 'not', 'is'])
      chain[m] = () => chain;
    return chain;
  };
  const client =
    opts.calls || opts.failTable
      ? new Proxy(db.client as { from: (table: string) => unknown }, {
          get: (target, key, receiver) =>
            key === 'from'
              ? (table: string) => {
                  calls.push(table);
                  return table === opts.failTable ? failing() : target.from(table);
                }
              : Reflect.get(target, key, receiver),
        })
      : db.client;
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', client);
    set('orgId', ORG);
    set('userId', opts.teacher ? 'u-teacher' : 'u1');
    set('roles', opts.teacher ? ['teacher'] : ['admin']);
    set('campusScope', opts.campusScope ?? null);
    await next();
  });
  app.route('/', studentsRoute as unknown as Hono);
  const res = await app.request(`/?${query}`);
  return {
    status: res.status,
    body: (await res.json()) as {
      code?: string;
      data: Array<{ id: string; todayStatus?: { state: string } | null }>;
      summary: {
        today?: Record<string, number> | null;
        byGrade: Array<{ grade: string; count: number }>;
      };
    },
  };
}

describe('GET /students —— 今日到班（#1314 SL1）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('第一頁：每列 todayStatus（沒課的是 null）＋summary.today', async () => {
    const { body } = await list('');
    expect(Object.fromEntries(body.data.map((s) => [s.id, s.todayStatus?.state ?? null]))).toEqual({
      's-arrived': 'arrived',
      's-missing': 'missing',
      's-notyet': 'not_yet',
      's-leave': 'on_leave',
      's-none': null,
    });
    expect(body.summary.today).toEqual({ any: 4, arrived: 1, not_yet: 1, missing: 1, on_leave: 1 });
  });

  it('today=missing 只回該到沒到的；年級章節計數跟著走', async () => {
    const { body } = await list('today=missing');
    expect(body.data.map((s) => s.id)).toEqual(['s-missing']);
    const counts = Object.fromEntries(
      body.summary.byGrade.filter((g) => g.count).map((g) => [g.grade, g.count]),
    );
    expect(counts).toEqual({ J2: 1 });
    // summary.today 是今天全體，不跟著篩選縮
    expect(body.summary.today?.['any']).toBe(4);
  });

  it('today=any 只回今天有課的', async () => {
    const { body } = await list('today=any');
    expect(body.data.map((s) => s.id).sort()).toEqual([
      's-arrived',
      's-leave',
      's-missing',
      's-notyet',
    ]);
  });

  it('非第一頁、或 withToday=false：不算（沒有 todayStatus 欄、summary.today null）', async () => {
    for (const q of ['page=2&pageSize=2', 'withToday=false']) {
      const { body } = await list(q);
      expect(body.summary.today).toBeNull();
      expect(body.data.every((s) => !('todayStatus' in s))).toBe(true);
    }
  });

  it('受限分校：只數範圍內分校的課', async () => {
    const { body } = await list('today=any', { campusScope: ['campus-2'] });
    expect(body.summary.today).toEqual({ any: 1, arrived: 0, not_yet: 1, missing: 0, on_leave: 0 });
  });

  it('逐堂點名模式：帶 today → 400 明講不支援；不帶 → 不算', async () => {
    const withFilter = await list('today=missing', { mode: 'per_session' });
    expect(withFilter.status).toBe(400);
    expect(withFilter.body.code).toBe('TODAY_UNSUPPORTED_MODE');

    const plain = await list('', { mode: 'per_session' });
    expect(plain.status).toBe(200);
    expect(plain.body.summary.today).toBeNull();
  });

  // reviewer 二讀 #1456 抓的：拿掉老師的 taughtStudentIds 剔除原本全綠
  it('老師：summary.today 只算任課班的學生（別班今天有課的不算）', async () => {
    const { body } = await list('', { teacher: true });
    expect(body.summary.today).toEqual({ any: 3, arrived: 1, not_yet: 0, missing: 1, on_leave: 1 });
  });

  // #1100 #51（使用者 10-23 裁定）：老師只看自己教的班的到班。s-notyet 是他的學生（c-tue），
  // 但今天只有別班 c-pm 的課 —— 老師看到的是「今天沒他的課」，不是別班那堂到了沒
  it('老師：他的學生今天只有別班的課 → todayStatus 是 null，也不進 summary', async () => {
    const { body } = await list('', { teacher: true });
    const row = body.data.find((s) => s.id === 's-notyet');
    expect(row).toBeDefined();
    expect(row!.todayStatus ?? null).toBeNull();
    expect(body.summary.today?.['not_yet']).toBe(0);
  });

  // #1595 P3b-A：開頁預設（沒帶 today）時今日到班跟列表同時跑。串行的話，列表那一輪
  // （列表＋在籍數＋年級計數，P3b-B 起年級計數是 1 支聚合，共 3 次 from('students')）
  // 要等 daily_checkins 查完才發
  it('沒帶 today：列表與年級計數不等今日到班查完就發出', async () => {
    const calls: string[] = [];
    const { body } = await list('', { calls });
    expect(body.summary.today).toEqual({ any: 4, arrived: 1, not_yet: 1, missing: 1, on_leave: 1 });
    const studentsBeforeCheckins = calls
      .slice(0, calls.indexOf('daily_checkins'))
      .filter((t) => t === 'students').length;
    expect(studentsBeforeCheckins).toBeGreaterThanOrEqual(3);
  });

  it('帶 today：列表要用它的結果，所以照舊先算完今日到班', async () => {
    const calls: string[] = [];
    await list('today=missing', { calls });
    const studentsBeforeCheckins = calls
      .slice(0, calls.indexOf('daily_checkins'))
      .filter((t) => t === 'students').length;
    expect(studentsBeforeCheckins).toBeLessThan(3);
  });

  // 並行之後，沒帶 today 時今日到班的錯誤是在列表之後才收 —— 收的時候也要照樣回 500，
  // 不能默默當成「今天沒人」
  it('沒帶 today：今日課堂查詢失敗 → 500', async () => {
    const { status } = await list('', { failTable: 'sessions' });
    expect(status).toBe(500);
  });
});
