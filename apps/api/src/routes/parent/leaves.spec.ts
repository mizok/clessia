import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../../lib/child-db';
import { notifyLeaveStreaks } from '../../lib/leave-streak';
import { notifyLeaveForAdmins, notifyLeaveForTeachers } from '../../lib/notify-leave';
import { createMultiOrgDb } from '../../test-utils/multi-org-db';
import { restBackedLeavePool } from '../../test-utils/rest-backed-leave-pool';
import leavesRoute from './leaves';

// 收件人推導是 notify-leave 自己的事；這裡只驗「發了、發給哪幾堂」
// #1732：連續請假偵測的演算法由 leave-streak.spec 守；這裡只驗「建單後偵測、用這張假的日期」
vi.mock('../../lib/leave-streak', () => ({ notifyLeaveStreaks: vi.fn(async () => undefined) }));
vi.mock('../../lib/notify-leave', () => ({
  notifyLeaveForTeachers: vi.fn(async () => undefined),
  notifyLeaveForAdmins: vi.fn(async () => undefined),
}));

/**
 * 家長幫孩子請假（#1695）。真的 `createChildDb` 疊在照條件過濾的替身上（同 trial-requests）。
 */
const ORG = 'org-1';
const MY_CHILD = '00000000-0000-4000-8000-0000000000b1';
const OTHER_CHILD = '00000000-0000-4000-8000-0000000000b2';
const MATH = 'class-math';
const ENGLISH = 'class-english';
const DROPPED = 'class-dropped';

const session = (
  id: string,
  classId: string,
  date: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  org_id: ORG,
  class_id: classId,
  session_date: date,
  start_time: '18:00:00',
  end_time: '20:00:00',
  status: 'scheduled',
  event_id: `ev-${id}`,
  events: { event_date: date, start_time: '18:00:00', end_time: '20:00:00' },
  ...extra,
});

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return createMultiOrgDb({
    enrollments: [
      {
        org_id: ORG,
        student_id: MY_CHILD,
        class_id: MATH,
        status: 'active',
        effective_from: '2026-09-01',
        effective_to: null,
      },
      {
        org_id: ORG,
        student_id: MY_CHILD,
        class_id: ENGLISH,
        status: 'active',
        effective_from: '2026-09-01',
        effective_to: null,
      },
      {
        org_id: ORG,
        student_id: MY_CHILD,
        class_id: DROPPED,
        status: 'withdrawn',
        effective_from: '2026-09-01',
        effective_to: null,
      },
      {
        org_id: ORG,
        student_id: OTHER_CHILD,
        class_id: MATH,
        status: 'active',
        effective_from: '2026-09-01',
        effective_to: null,
      },
    ],
    sessions: [
      session('s-math-1020', MATH, '2026-10-20'),
      session('s-eng-1020', ENGLISH, '2026-10-20', {
        start_time: '14:00:00',
        end_time: '16:00:00',
        events: { event_date: '2026-10-20', start_time: '14:00:00', end_time: '16:00:00' },
      }),
      session('s-math-1022', MATH, '2026-10-22', { event_id: null, events: null }),
      session('s-math-1027', MATH, '2026-10-27', { status: 'cancelled' }),
      session('s-dropped-1023', DROPPED, '2026-10-23'),
      session('s-math-1001', MATH, '2026-10-01'),
    ],
    leave_requests: [],
    attendance_records: [],
    audit_logs: [],
    ...extra,
  });
}

function appFor(
  db: ReturnType<typeof createMultiOrgDb>,
  roles = ['parent'],
  scope: string[] = [MY_CHILD],
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', roles);
    set('orgId', ORG);
    set('userId', 'parent-user');
    set('studentScope', scope);
    set('childDb', createChildDb(db.client as never, scope, ORG, restBackedLeavePool(db.client) as never));
    await next();
  });
  app.route('/', leavesRoute as unknown as Hono);
  return app;
}

async function submit(
  body: Record<string, unknown>,
  db = seed(),
  roles?: string[],
  scope?: string[],
) {
  vi.mocked(notifyLeaveForTeachers).mockClear();
  vi.mocked(notifyLeaveForAdmins).mockClear();
  vi.mocked(notifyLeaveStreaks).mockClear();
  const res = await appFor(db, roles, scope).request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId: MY_CHILD, ...body }),
  });
  return {
    status: res.status,
    body: (await res.json()) as any,
    leaves: db.rows('leave_requests'),
    records: db.rows('attendance_records'),
  };
}

describe('POST /api/me/leaves', () => {
  it('建單：家長送的、org 取 session；有 event 的堂寫 on_leave；通知蓋到的堂', async () => {
    const { status, body, leaves, records } = await submit({
      startDate: '2026-10-20',
      endDate: '2026-10-22',
      startTime: '17:00',
      endTime: '21:00',
      reason: '家裡有事',
    });

    expect(status).toBe(201);
    expect(body.data).toMatchObject({ startDate: '2026-10-20', endDate: '2026-10-22' });
    expect(leaves).toHaveLength(1);
    expect(leaves[0]).toMatchObject({
      org_id: ORG,
      student_id: MY_CHILD,
      submitted_by: 'parent-user',
      submitted_by_role: 'parent',
      reason: '家裡有事',
    });
    // 多日假整天蓋：10/20 兩堂都蓋；10/22 沒有 event（懶生成）不寫紀錄；停課、退班的不算
    expect(records.map((r) => [r['event_id'], r['status'], r['org_id']]).sort()).toEqual([
      ['ev-s-eng-1020', 'on_leave', ORG],
      ['ev-s-math-1020', 'on_leave', ORG],
    ]);
    const call = vi.mocked(notifyLeaveForTeachers).mock.calls[0]![1];
    expect([...call.sessionIds].sort()).toEqual(['s-eng-1020', 's-math-1020', 's-math-1022']);
    expect(call.leaveId).toBe(leaves[0]!['id']);
  });

  // 計畫席 10-17：補請把缺席改成請假、沒有人核對 —— 稽核要記蓋到幾堂、幾堂是補請，不帶個資
  it('建單之後偵測連續請假（#1732）：用假單的學生與日期', async () => {
    const { status } = await submit({ startDate: '2026-10-20', endDate: '2026-10-22' });
    expect(status).toBe(201);
    expect(notifyLeaveStreaks).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyLeaveStreaks).mock.calls[0]![1]).toMatchObject({
      orgId: ORG,
      studentId: MY_CHILD,
      from: '2026-10-20',
      to: '2026-10-22',
    });
  });

  it('稽核：記 parent、蓋到的堂數與補請（開始時間已過）的堂數；名字不進 resource_name', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T09:00:00Z')); // 台北 10/20 17:00：英文 14:00 已開始、數學 18:00 還沒
    try {
      const db = seed();
      const { status, leaves } = await submit(
        { startDate: '2026-10-01', endDate: '2026-10-22' },
        db,
      );
      await new Promise((r) => setTimeout(r, 0)); // logAudit 在背景寫
      expect(status).toBe(201);
      const audit = db.rows('audit_logs');
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        user_id: 'parent-user',
        resource_type: 'leave',
        resource_id: leaves[0]!['id'],
        resource_name: '家長請假 / 2026-10-01 ~ 2026-10-22',
        details: {
          submittedByRole: 'parent',
          sessionCount: 4,
          retroactiveSessionCount: 2,
          skippedAttendedCount: 0,
        },
      });
      // 有堂已經開始 → 管理員那則標「補請」
      expect(vi.mocked(notifyLeaveForAdmins).mock.calls[0]![1]).toMatchObject({
        leaveId: leaves[0]!['id'],
        retroactive: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // 審核席突變：`> 0` 改成 `> 1` 要轉紅 —— 恰好一堂已開始也算補請
  it('通知管理員：區間裡恰好一堂已開始 → 標補請', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T07:00:00Z')); // 台北 10/20 15:00：只有英文 14:00 那堂已開始
    try {
      const { status } = await submit({ startDate: '2026-10-20', endDate: '2026-10-22' });
      expect(status).toBe(201);
      const call = vi.mocked(notifyLeaveForAdmins).mock.calls[0]![1];
      expect(call.retroactive).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('通知管理員：蓋到的課都還沒開始 → 不標補請；只列真的改成請假的堂', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T00:00:00Z'));
    try {
      const { status } = await submit({ startDate: '2026-10-20', endDate: '2026-10-22' });
      expect(status).toBe(201);
      const call = vi.mocked(notifyLeaveForAdmins).mock.calls[0]![1];
      expect(call.retroactive).toBe(false);
      expect([...call.sessionIds].sort()).toEqual(['s-eng-1020', 's-math-1020', 's-math-1022']);
    } finally {
      vi.useRealTimers();
    }
  });

  // 計畫席 10-19 裁 (a)：家長只能把「沒有紀錄」或「缺席」翻成請假，老師點的出席不動
  it('補請：出席的堂維持出席、缺席的改成請假、沒有紀錄的改成請假；略過的堂數回在回應與稽核、通知不列', async () => {
    const db = seed({
      sessions: [
        session('s-present', MATH, '2026-10-06'),
        session('s-absent', MATH, '2026-10-07'),
        session('s-none', MATH, '2026-10-08'),
        session('s-lazy', MATH, '2026-10-09', { event_id: null, events: null }),
      ],
      attendance_records: [
        {
          org_id: ORG,
          student_id: MY_CHILD,
          event_id: 'ev-s-present',
          status: 'present',
          recorded_by: 'teacher-1',
        },
        {
          org_id: ORG,
          student_id: MY_CHILD,
          event_id: 'ev-s-absent',
          status: 'absent',
          recorded_by: 'teacher-1',
        },
        // 別的孩子在同一堂出席，不影響這個孩子
        {
          org_id: ORG,
          student_id: OTHER_CHILD,
          event_id: 'ev-s-none',
          status: 'present',
          recorded_by: 'teacher-1',
        },
      ],
    });
    // 全部都已經上過：補請堂數＝真的改成請假的三堂，**不含**被略過的出席那堂
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T04:00:00Z'));
    let result: Awaited<ReturnType<typeof submit>>;
    try {
      result = await submit({ startDate: '2026-10-06', endDate: '2026-10-09' }, db);
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      vi.useRealTimers();
    }
    const { status, body, records } = result;

    expect(status).toBe(201);
    expect(body.data.skippedAttendedCount).toBe(1);
    const mine = Object.fromEntries(
      records
        .filter((r) => r['student_id'] === MY_CHILD)
        .map((r) => [r['event_id'], [r['status'], r['recorded_by']]]),
    );
    expect(mine).toEqual({
      'ev-s-present': ['present', 'teacher-1'],
      'ev-s-absent': ['on_leave', 'parent-user'],
      'ev-s-none': ['on_leave', 'parent-user'],
    });
    expect(db.rows('audit_logs')[0]?.['details']).toMatchObject({
      sessionCount: 3,
      retroactiveSessionCount: 3,
      skippedAttendedCount: 1,
    });
    const call = vi.mocked(notifyLeaveForTeachers).mock.calls[0]![1];
    expect([...call.sessionIds].sort()).toEqual(['s-absent', 's-lazy', 's-none']);
  });

  /** 什麼都沒寫：不建單、不寫出勤、不通知、不稽核 */
  function expectNothingWritten(
    db: ReturnType<typeof seed>,
    before: { leaves: number; records: number },
  ) {
    expect(db.rows('leave_requests')).toHaveLength(before.leaves);
    expect(db.rows('attendance_records')).toHaveLength(before.records);
    expect(db.rows('audit_logs')).toHaveLength(0);
    expect(notifyLeaveForTeachers).not.toHaveBeenCalled();
    expect(notifyLeaveForAdmins).not.toHaveBeenCalled();
  }

  // 審核席：讀不到既有出勤就不知道哪幾堂已經點成出席 —— 不能 fail-open 把出席蓋成請假
  it('讀既有出勤失敗：500（fail-closed），什麼都不寫', async () => {
    const db = seed();
    const client = db.client as { from: (table: string) => Record<string, unknown> };
    const realFrom = client.from.bind(client);
    const failing = {
      eq: () => failing,
      in: () => failing,
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { code: 'XX000', message: 'boom' } }),
    };
    vi.spyOn(client, 'from').mockImplementation(((table: string) => {
      const builder = realFrom(table);
      return table === 'attendance_records' ? { ...builder, select: () => failing } : builder;
    }) as never);

    const { status } = await submit({ startDate: '2026-10-20', endDate: '2026-10-20' }, db);
    await new Promise((r) => setTimeout(r, 0));

    expect(status).toBe(500);
    expectNothingWritten(db, { leaves: 0, records: 0 });
  });

  // 計畫席 10-19：每一堂都已經點成出席，這張假什麼都不會改 —— 不建單
  it('區間內每一堂都已經出席：400 ALL_ATTENDED，什麼都不寫', async () => {
    const db = seed({
      sessions: [session('s-a', MATH, '2026-10-06'), session('s-b', ENGLISH, '2026-10-06')],
      attendance_records: [
        { org_id: ORG, student_id: MY_CHILD, event_id: 'ev-s-a', status: 'present' },
        { org_id: ORG, student_id: MY_CHILD, event_id: 'ev-s-b', status: 'present' },
      ],
    });

    const { status, body } = await submit({ startDate: '2026-10-06', endDate: '2026-10-06' }, db);
    await new Promise((r) => setTimeout(r, 0));

    expect(status).toBe(400);
    expect(body.code).toBe('ALL_ATTENDED');
    expectNothingWritten(db, { leaves: 0, records: 2 });
    expect(db.rows('attendance_records').map((r) => r['status'])).toEqual(['present', 'present']);
  });

  it('兄弟姊妹在同一堂出席，不影響這個孩子（讀出勤只看這個孩子，不是整個 scope）', async () => {
    const db = seed({
      sessions: [session('s-shared', MATH, '2026-10-06')],
      attendance_records: [
        { org_id: ORG, student_id: OTHER_CHILD, event_id: 'ev-s-shared', status: 'present' },
      ],
    });
    const { status, body, records } = await submit(
      { startDate: '2026-10-06', endDate: '2026-10-06' },
      db,
      ['parent'],
      [MY_CHILD, OTHER_CHILD],
    );

    expect(status).toBe(201);
    expect(body.data.skippedAttendedCount).toBe(0);
    expect(records.find((r) => r['student_id'] === MY_CHILD)?.['status']).toBe('on_leave');
    expect(records.find((r) => r['student_id'] === OTHER_CHILD)?.['status']).toBe('present');
  });

  it('單日時間窗只蓋時間重疊的堂（判準同管理端）', async () => {
    const { status, records } = await submit({
      startDate: '2026-10-20',
      endDate: '2026-10-20',
      startTime: '17:00',
      endTime: '21:00',
    });

    expect(status).toBe(201);
    expect(records.map((r) => r['event_id'])).toEqual(['ev-s-math-1020']);
  });

  it('可以補請：已經上完的課也能請（Q1 更正）', async () => {
    const { status, records } = await submit({
      startDate: '2026-10-01',
      endDate: '2026-10-01',
      startTime: '17:00',
      endTime: '21:00',
    });

    expect(status).toBe(201);
    expect(records.map((r) => r['event_id'])).toEqual(['ev-s-math-1001']);
  });

  it('區間內一堂課都沒有（含只有停課、退班的課）：400 NO_SESSIONS，不建單（Q4）', async () => {
    for (const [startDate, endDate] of [
      ['2026-10-25', '2026-10-25'],
      ['2026-10-27', '2026-10-27'],
      ['2026-10-23', '2026-10-23'],
    ]) {
      const { status, body, leaves, records } = await submit({ startDate, endDate });
      expect(status).toBe(400);
      expect(body.code).toBe('NO_SESSIONS');
      expect(leaves).toHaveLength(0);
      expect(records).toHaveLength(0);
    }
  });

  it('跟已有的假重疊：409，不寫入、不通知', async () => {
    const db = seed({
      leave_requests: [
        {
          id: 'old',
          org_id: ORG,
          student_id: MY_CHILD,
          start_date: '2026-10-21',
          end_date: '2026-10-21',
          start_time: null,
          end_time: null,
        },
      ],
    });
    const { status, body, leaves, records } = await submit(
      { startDate: '2026-10-20', endDate: '2026-10-22' },
      db,
    );

    expect(status).toBe(409);
    expect(body.code).toBe('LEAVE_OVERLAP');
    expect(leaves).toHaveLength(1);
    expect(records).toHaveLength(0);
    expect(notifyLeaveForTeachers).not.toHaveBeenCalled();
    expect(notifyLeaveStreaks).not.toHaveBeenCalled();
  });

  it('別的孩子已有的假不算重疊（重疊只看自己這個孩子）', async () => {
    const db = seed({
      leave_requests: [
        {
          id: 'theirs',
          org_id: ORG,
          student_id: OTHER_CHILD,
          start_date: '2026-10-20',
          end_date: '2026-10-20',
          start_time: null,
          end_time: null,
        },
      ],
    });
    const { status } = await submit({ startDate: '2026-10-20', endDate: '2026-10-20' }, db);
    expect(status).toBe(201);
  });

  it('別人的孩子：403，不寫任何資料、不通知、不寫稽核', async () => {
    const db0 = seed();
    const { status, body, leaves, records } = await submit(
      { studentId: OTHER_CHILD, startDate: '2026-10-20', endDate: '2026-10-20' },
      db0,
    );

    expect(status).toBe(403);
    expect(body.code).toBe('NOT_YOUR_CHILD');
    expect(leaves).toHaveLength(0);
    expect(records).toHaveLength(0);
    expect(notifyLeaveForTeachers).not.toHaveBeenCalled();
    expect(db0.rows('audit_logs')).toHaveLength(0);
  });

  it('不是家長：403', async () => {
    const { status, leaves } = await submit(
      { startDate: '2026-10-20', endDate: '2026-10-20' },
      seed(),
      ['teacher'],
    );
    expect(status).toBe(403);
    expect(leaves).toHaveLength(0);
  });

  it('結束早於開始：400，不建單', async () => {
    const { status, leaves } = await submit({ startDate: '2026-10-22', endDate: '2026-10-20' });
    expect(status).toBe(400);
    expect(leaves).toHaveLength(0);
  });
});
