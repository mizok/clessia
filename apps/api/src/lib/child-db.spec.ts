import { describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import { notifyLeaveStreaks } from './leave-streak';
import { notifyLeaveForAdmins, notifyLeaveForTeachers } from './notify-leave';

// notifyLeave 的收件人推導是 notify-leave 自己的事（有自己的 spec）；這裡只驗「發不發、發給哪張假」
vi.mock('./notify-events', () => ({ notifyNewApplication: vi.fn(async () => undefined) }));
vi.mock('./notify-leave', () => ({
  notifyLeaveForTeachers: vi.fn(async () => undefined),
  notifyLeaveForAdmins: vi.fn(async () => undefined),
}));
vi.mock('./leave-streak', () => ({ notifyLeaveStreaks: vi.fn(async () => undefined) }));
import { notifyNewApplication } from './notify-events';
import { createChildDb, type ScopedIds } from './child-db';

/** 只實作 `.from().select().in()` 這條鏈，並記下每次呼叫收到的參數。 */
function fakeSupabase() {
  const calls: {
    table?: string;
    columns?: string;
    options?: unknown;
    inColumn?: string;
    inValues?: string[];
  } = {};
  return {
    calls,
    client: {
      from: (table: string) => {
        calls.table = table;
        return {
          select: (columns: string, options?: unknown) => {
            calls.columns = columns;
            calls.options = options;
            const builder = {
              in: (col: string, values: string[]) => {
                calls.inColumn = col;
                calls.inValues = values;
                return Promise.resolve({ data: [], error: null });
              },
            };
            return builder;
          },
        };
      },
    },
  };
}

describe('createChildDb', () => {
  it('scope 是陣列時，每次 from().select() 都自動帶上 .in(studentIdColumn, scope)', async () => {
    const { calls, client } = fakeSupabase();
    const childDb = createChildDb(client as never, ['s1', 's2'], 'org-1');

    await childDb.from('students', 'id').select('id, name');

    expect(calls.table).toBe('students');
    expect(calls.columns).toBe('id, name');
    expect(calls.inColumn).toBe('id');
    expect(calls.inValues).toEqual(['s1', 's2']);
  });

  // 這條是設計文件點死的：沒綁小孩的家長要查到「什麼都沒有」，
  // 不能因為 scope 是空陣列就略過條件、查到全部。
  it('scope 是空陣列時仍然送出 .in(column, [])，不是略過條件', async () => {
    const { calls, client } = fakeSupabase();
    const childDb = createChildDb(client as never, [], 'org-1');

    await childDb.from('scores', 'student_id').select('*');

    expect(calls.inColumn).toBe('student_id');
    expect(calls.inValues).toEqual([]);
  });

  it('scope 是 null 時不加條件（理論上不會發生在家長端 route，但防禦性保留）', async () => {
    const calls: { inCalled: boolean } = { inCalled: false };
    const query = {
      in: () => {
        calls.inCalled = true;
        throw new Error('不該被呼叫');
      },
    };
    const client = { from: () => ({ select: () => query }) };

    const childDb = createChildDb(client as never, null, 'org-1');
    const result = await childDb.from('students', 'id').select('*');

    expect(result).toBe(query);
    expect(calls.inCalled).toBe(false);
  });

  // 家長端的 meta 聚合數字（monthlyAbsentCount / recentCount / totalDue）要用
  // count/head 查詢算，不能靠當頁筆數 —— 這條釘住 options 有原樣傳到底層 supabase
  it('select() 的第二個參數（count/head）原樣傳給底層 supabase', async () => {
    const { calls, client } = fakeSupabase();
    const childDb = createChildDb(client as never, ['s1'], 'org-1');

    await childDb.from('scores', 'student_id').select('id', { count: 'exact', head: true });

    expect(calls.options).toEqual({ count: 'exact', head: true });
  });
});

/**
 * `pluck()` / `fromScopedIds()` —— 給沒有 `student_id` 欄位的表（如
 * `class_logs`，班級層級不是學生層級）用。見
 * kb/wiki/architecture/parent-class-logs-read.md 第三節。
 */
describe('createChildDb —— pluck / fromScopedIds', () => {
  function fakePluckSupabase(rows: unknown[]) {
    const calls: { table?: string; inColumn?: string; inValues?: string[] } = {};
    return {
      calls,
      client: {
        from: (table: string) => {
          calls.table = table;
          return {
            select: () => ({
              in: (col: string, values: string[]) => {
                calls.inColumn = col;
                calls.inValues = values;
                return { eq: () => Promise.resolve({ data: rows, error: null }) };
              },
            }),
          };
        },
      },
    };
  }

  it('pluck() 一次回完整列與去重後的 ScopedIds', async () => {
    const rows = [
      { class_id: 'class-1', effective_from: '2026-01-01' },
      { class_id: 'class-2', effective_from: '2026-04-01' },
      { class_id: 'class-1', effective_from: '2026-07-01' },
    ];
    const { client } = fakePluckSupabase(rows);
    const childDb = createChildDb(client as never, ['s1'], 'org-1');

    const result = await childDb
      .from('enrollments', 'student_id')
      .pluck('class_id', 'class_id', 's1');

    expect(result.error).toBeNull();
    expect(result.rows).toEqual(rows);
    expect(result.ids).toEqual(['class-1', 'class-2']);
  });

  it('pluck() 查詢失敗時 rows 與 ids 都回空，不吞錯誤', async () => {
    const client = {
      from: () => ({
        select: () => ({
          in: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }),
        }),
      }),
    };
    const childDb = createChildDb(client as never, ['s1'], 'org-1');

    const result = await childDb
      .from('enrollments', 'student_id')
      .pluck('class_id', 'class_id', 's1');

    expect(result.rows).toEqual([]);
    expect(result.ids).toEqual([]);
    expect(result.error).toEqual({ message: 'boom' });
  });

  it('fromScopedIds() 用 pluck() 產生的 ids 查沒有 student_id 的表', async () => {
    const { calls, client: pluckClient } = fakePluckSupabase([{ class_id: 'class-1' }]);
    const childDb = createChildDb(pluckClient as never, ['s1'], 'org-1');
    const { ids } = await childDb
      .from('enrollments', 'student_id')
      .pluck('class_id', 'class_id', 's1');
    expect(calls.table).toBe('enrollments');

    const scopedCalls: { table?: string; inColumn?: string; inValues?: readonly string[] } = {};
    const scopedClient = {
      from: (table: string) => {
        scopedCalls.table = table;
        return {
          select: () => ({
            in: (col: string, values: readonly string[]) => {
              scopedCalls.inColumn = col;
              scopedCalls.inValues = values;
              return Promise.resolve({ data: [], error: null });
            },
          }),
        };
      },
    };
    const scopedChildDb = createChildDb(scopedClient as never, ['s1'], 'org-1');
    await scopedChildDb.fromScopedIds('class_logs', 'class_id', ids).select('id, homework');

    expect(scopedCalls.table).toBe('class_logs');
    expect(scopedCalls.inColumn).toBe('class_id');
    expect(scopedCalls.inValues).toEqual(['class-1']);
  });

  it('型別擋：裸 string[] 傳不進 fromScopedIds，只有 pluck() 產生的 ScopedIds 過得了', () => {
    const client = { from: () => ({ select: () => ({ in: () => Promise.resolve({}) }) }) };
    const childDb = createChildDb(client as never, ['s1'], 'org-1');

    const bareArray: readonly string[] = ['class-1'];
    // @ts-expect-error —— 裸陣列不是 ScopedIds，這行本來就該編不過；
    // 拿掉這個註解時 tsc 應該報 TS2345，證明品牌型別真的在擋，不是只活在文件裡
    childDb.fromScopedIds('class_logs', 'class_id', bareArray);
  });
});

/**
 * 寫入口與機構參考資料（#1119，計畫席 10-03 裁 A＋B）。家長端第一次寫入 ——
 * 範圍檢查在**送 DB 之前**做，`org_id` 一律取 session 的、不吃呼叫端給的。
 * 用真的照條件過濾的替身：回固定資料的替身分不出條件有沒有下對。
 */
describe('createChildDb —— insert / update / orgRef / activeEnrollmentCount', () => {
  const MY_CHILD = 'stu-mine';
  const OTHER_CHILD = 'stu-other';

  it('insert：學生在 scope 內 → 寫入，org_id 蓋成 session 的（呼叫端給的別 org 被覆蓋）', async () => {
    const db = createMultiOrgDb({});
    const childDb = createChildDb(db.client as never, [MY_CHILD], 'org-1');

    const result = await childDb
      .from('enrollment_requests', 'student_id')
      .insert({ student_id: MY_CHILD, org_id: 'org-evil', status: 'pending' });

    expect(result.outOfScope).toBe(false);
    expect(db.rows('enrollment_requests')).toHaveLength(1);
    expect(db.rows('enrollment_requests')[0]?.['org_id']).toBe('org-1');
  });

  it('insert：scope 外的學生 → 不送 DB，回 outOfScope', async () => {
    const db = createMultiOrgDb({});
    const childDb = createChildDb(db.client as never, [MY_CHILD], 'org-1');

    const result = await childDb
      .from('enrollment_requests', 'student_id')
      .insert({ student_id: OTHER_CHILD, status: 'pending' });

    expect(result.outOfScope).toBe(true);
    expect(db.rows('enrollment_requests')).toHaveLength(0);
  });

  it('insert：不是家長（scope null）→ fail-closed，不送 DB', async () => {
    const db = createMultiOrgDb({});
    const childDb = createChildDb(db.client as never, null, 'org-1');

    const result = await childDb
      .from('enrollment_requests', 'student_id')
      .insert({ student_id: MY_CHILD });

    expect(result.outOfScope).toBe(true);
    expect(db.rows('enrollment_requests')).toHaveLength(0);
  });

  it('update：scope 外與別 org 的列選不到；學生欄位與 org_id 不會被改掉', async () => {
    const db = createMultiOrgDb({
      enrollment_requests: [
        { id: 'r-mine', org_id: 'org-1', student_id: MY_CHILD, status: 'pending' },
        { id: 'r-other', org_id: 'org-1', student_id: OTHER_CHILD, status: 'pending' },
        { id: 'r-foreign', org_id: 'org-2', student_id: MY_CHILD, status: 'pending' },
      ],
    });
    const childDb = createChildDb(db.client as never, [MY_CHILD], 'org-1');

    await childDb
      .from('enrollment_requests', 'student_id')
      .update({ status: 'cancelled', student_id: OTHER_CHILD, org_id: 'org-2' });

    const state = Object.fromEntries(
      db.rows('enrollment_requests').map((r) => [r['id'], [r['status'], r['student_id']]]),
    );
    expect(state).toEqual({
      'r-mine': ['cancelled', MY_CHILD],
      'r-other': ['pending', OTHER_CHILD],
      'r-foreign': ['pending', MY_CHILD],
    });
  });

  it('update：不是家長（scope null）→ 一列都選不到', async () => {
    const db = createMultiOrgDb({
      enrollment_requests: [{ id: 'r', org_id: 'org-1', student_id: MY_CHILD, status: 'pending' }],
    });
    const childDb = createChildDb(db.client as never, null, 'org-1');

    await childDb.from('enrollment_requests', 'student_id').update({ status: 'cancelled' });

    expect(db.rows('enrollment_requests')[0]?.['status']).toBe('pending');
  });

  it('orgRef：只帶 org 條件，別 org 的班讀不到', async () => {
    const db = createMultiOrgDb({
      classes: [
        { id: 'c1', org_id: 'org-1' },
        { id: 'c2', org_id: 'org-2' },
      ],
    });
    const childDb = createChildDb(db.client as never, [MY_CHILD], 'org-1');

    const { data } = await childDb.orgRef('classes').select('id');

    expect((data as unknown as Array<{ id: string }>).map((r) => r.id)).toEqual(['c1']);
  });

  it('activeEnrollmentCount：只回數字（在籍＋待繳費），不跨 org', async () => {
    const db = createMultiOrgDb({
      enrollments: [
        { org_id: 'org-1', class_id: 'c1', student_id: 'a', status: 'active' },
        { org_id: 'org-1', class_id: 'c1', student_id: 'b', status: 'pending_payment' },
        { org_id: 'org-1', class_id: 'c1', student_id: 'c', status: 'withdrawn' },
        { org_id: 'org-2', class_id: 'c1', student_id: 'd', status: 'active' },
      ],
    });
    const childDb = createChildDb(db.client as never, [MY_CHILD], 'org-1');

    expect(await childDb.activeEnrollmentCount('c1')).toEqual({ count: 2, error: null });
  });
});

/** #1120：試聽一次可選多門課 —— 一批寫入，**任一列 scope 外就整批不送** */
describe('createChildDb —— insertMany', () => {
  it('全部在 scope 內：整批寫入，org_id 蓋成 session 的', async () => {
    const db = createMultiOrgDb({});
    const childDb = createChildDb(db.client as never, ['stu-mine'], 'org-1');

    const result = await childDb.from('trial_requests', 'student_id').insertMany([
      { student_id: 'stu-mine', course_id: 'a', org_id: 'org-evil' },
      { student_id: 'stu-mine', course_id: 'b' },
    ]);

    expect(result.outOfScope).toBe(false);
    expect(db.rows('trial_requests').map((r) => r['org_id'])).toEqual(['org-1', 'org-1']);
  });

  it('混了一列 scope 外的：整批不送 DB', async () => {
    const db = createMultiOrgDb({});
    const childDb = createChildDb(db.client as never, ['stu-mine'], 'org-1');

    const result = await childDb.from('trial_requests', 'student_id').insertMany([
      { student_id: 'stu-mine', course_id: 'a' },
      { student_id: 'stu-other', course_id: 'b' },
    ]);

    expect(result.outOfScope).toBe(true);
    expect(db.rows('trial_requests')).toHaveLength(0);
  });

  it('空陣列：當成 scope 外（不送一個空 insert）', async () => {
    const db = createMultiOrgDb({});
    const childDb = createChildDb(db.client as never, ['stu-mine'], 'org-1');

    expect((await childDb.from('trial_requests', 'student_id').insertMany([])).outOfScope).toBe(
      true,
    );
  });
});

describe('createChildDb —— pluck 只拿指名的那個孩子（#1116）', () => {
  it('兄弟姊妹都在 scope 裡，pluck 只回 studentId 那個孩子的列；scope 外的 id 回空', async () => {
    const db = createMultiOrgDb({
      enrollments: [
        { student_id: 's1', class_id: 'class-1' },
        { student_id: 's2', class_id: 'class-2' },
        { student_id: 's3', class_id: 'class-3' },
      ],
    });
    const childDb = createChildDb(db.client as never, ['s1', 's2'], 'org-1');

    const own = await childDb.from('enrollments', 'student_id').pluck('class_id', 'class_id', 's1');
    expect(own.ids).toEqual(['class-1']);

    const outside = await childDb
      .from('enrollments', 'student_id')
      .pluck('class_id', 'class_id', 's3');
    expect(outside.ids).toEqual([]);
  });
});

describe('createChildDb —— orgPaymentInfo（#1073）', () => {
  it('只讀 session 那個 org 的帳戶資訊，只回這一欄', async () => {
    const db = createMultiOrgDb({
      organizations: [
        { id: 'org-1', payment_info: '台銀 004', invoice_due_days: 14 },
        { id: 'org-2', payment_info: '別家的帳戶' },
      ],
    });
    const childDb = createChildDb(db.client as never, ['s1'], 'org-1');

    expect(await childDb.orgPaymentInfo()).toEqual({ paymentInfo: '台銀 004', error: null });
  });
});

describe('createChildDb —— dailyCheckinCampusIds（#1075）', () => {
  const db = () =>
    createMultiOrgDb({
      organizations: [
        { id: 'org-1', attendance_mode: 'per_session' },
        { id: 'org-2', attendance_mode: 'daily_checkin' },
      ],
      campuses: [
        { id: 'c-daily', org_id: 'org-1', attendance_mode: 'daily_checkin' },
        { id: 'c-session', org_id: 'org-1', attendance_mode: 'per_session' },
        { id: 'c-inherit', org_id: 'org-1', attendance_mode: null },
        { id: 'c-other-org', org_id: 'org-2', attendance_mode: 'daily_checkin' },
      ],
    });

  it('分校自己的設定優先，null 沿用機構預設；只回生效模式是日到班的', async () => {
    const childDb = createChildDb(db().client as never, ['s1'], 'org-1');

    expect(await childDb.dailyCheckinCampusIds(['c-daily', 'c-session', 'c-inherit'])).toEqual({
      ids: ['c-daily'],
      error: null,
    });
  });

  it('別 org 的分校 id 讀不到列，退回本 org 的預設（不是那個分校的設定）', async () => {
    const childDb = createChildDb(db().client as never, ['s1'], 'org-1');

    expect((await childDb.dailyCheckinCampusIds(['c-other-org'])).ids).toEqual([]);
  });

  it('讀機構失敗 → 回 error，不猜', async () => {
    const childDb = createChildDb(
      {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
              maybeSingle: async () => ({ data: null, error: { message: 'boom' } }),
            }),
          }),
        }),
      } as never,
      ['s1'],
      'org-1',
    );

    expect(await childDb.dailyCheckinCampusIds(['c-daily'])).toEqual({
      ids: [],
      error: { message: 'boom' },
    });
  });
});

/** #1695：家長請假寫 `on_leave` —— 範圍檢查照 insertMany */
describe('createChildDb —— upsert', () => {
  it('全部在 scope 內：整批寫入，org_id 蓋成 session 的', async () => {
    const db = createMultiOrgDb({});
    const childDb = createChildDb(db.client as never, ['stu-mine'], 'org-1');

    const result = await childDb.from('attendance_records', 'student_id').upsert(
      [
        { student_id: 'stu-mine', event_id: 'e1', status: 'on_leave', org_id: 'org-evil' },
        { student_id: 'stu-mine', event_id: 'e2', status: 'on_leave' },
      ],
      'student_id,event_id',
    );

    expect(result.outOfScope).toBe(false);
    expect(db.rows('attendance_records').map((r) => r['org_id'])).toEqual(['org-1', 'org-1']);
  });

  it('混了一列 scope 外的：整批不送 DB', async () => {
    const db = createMultiOrgDb({});
    const childDb = createChildDb(db.client as never, ['stu-mine'], 'org-1');

    const result = await childDb.from('attendance_records', 'student_id').upsert(
      [
        { student_id: 'stu-mine', event_id: 'e1', status: 'on_leave' },
        { student_id: 'stu-other', event_id: 'e2', status: 'on_leave' },
      ],
      'student_id,event_id',
    );

    expect(result.outOfScope).toBe(true);
    expect(db.rows('attendance_records')).toHaveLength(0);
  });

  it('空陣列、或不是家長（scope null）：當成 scope 外', async () => {
    const db = createMultiOrgDb({});
    const mine = createChildDb(db.client as never, ['stu-mine'], 'org-1');
    const none = createChildDb(db.client as never, null, 'org-1');

    expect(
      (await mine.from('attendance_records', 'student_id').upsert([], 'student_id,event_id'))
        .outOfScope,
    ).toBe(true);
    expect(
      (
        await none
          .from('attendance_records', 'student_id')
          .upsert([{ student_id: 'stu-mine', event_id: 'e1' }], 'student_id,event_id')
      ).outOfScope,
    ).toBe(true);
    expect(db.rows('attendance_records')).toHaveLength(0);
  });
});

/** #1695：通知是寫別人的列 —— 只有 scope 內孩子的假才會發 */
describe('createChildDb —— notifyLeave', () => {
  const leaves = [
    {
      id: 'leave-mine',
      org_id: 'org-1',
      student_id: 'stu-mine',
      reason: '看牙醫',
      students: { name: '林小華' },
    },
    { id: 'leave-other', org_id: 'org-1', student_id: 'stu-other', students: { name: '別人' } },
    { id: 'leave-org2', org_id: 'org-2', student_id: 'stu-mine', students: { name: '林小華' } },
  ];

  it('自己孩子的假：老師與管理員都發，學生名與原因由這裡讀（不吃呼叫端）', async () => {
    vi.mocked(notifyLeaveForTeachers).mockClear();
    vi.mocked(notifyLeaveForAdmins).mockClear();
    const db = createMultiOrgDb({ leave_requests: leaves });
    const childDb = createChildDb(db.client as never, ['stu-mine'], 'org-1');

    expect(await childDb.notifyLeave('leave-mine', ['s1'], 'parent-1', true)).toBe(true);
    expect(notifyLeaveForTeachers).toHaveBeenCalledWith(db.client, {
      orgId: 'org-1',
      actorUserId: 'parent-1',
      leaveId: 'leave-mine',
      studentName: '林小華',
      sessionIds: ['s1'],
    });
    expect(notifyLeaveForAdmins).toHaveBeenCalledWith(db.client, {
      orgId: 'org-1',
      leaveId: 'leave-mine',
      studentName: '林小華',
      reason: '看牙醫',
      sessionIds: ['s1'],
      retroactive: true,
    });
  });

  it('別人孩子的 leaveId、別 org 的假、不是家長：一律不發', async () => {
    vi.mocked(notifyLeaveForTeachers).mockClear();
    vi.mocked(notifyLeaveForAdmins).mockClear();
    const db = createMultiOrgDb({ leave_requests: leaves });
    const mine = createChildDb(db.client as never, ['stu-mine'], 'org-1');
    const none = createChildDb(db.client as never, null, 'org-1');

    expect(await mine.notifyLeave('leave-other', ['s1'], 'parent-1', false)).toBe(false);
    expect(await mine.notifyLeave('leave-org2', ['s1'], 'parent-1', false)).toBe(false);
    expect(await none.notifyLeave('leave-mine', ['s1'], 'parent-1', false)).toBe(false);
    expect(notifyLeaveForTeachers).not.toHaveBeenCalled();
    expect(notifyLeaveForAdmins).not.toHaveBeenCalled();
  });
});

/** #1732：家長請假後的連續請假偵測 —— 只對 scope 內孩子的假，學生與日期從 DB 讀 */
describe('createChildDb —— checkLeaveStreak', () => {
  const leaves = [
    {
      id: 'leave-mine',
      org_id: 'org-1',
      student_id: 'stu-mine',
      start_date: '2026-10-20',
      end_date: '2026-10-22',
    },
    {
      id: 'leave-other',
      org_id: 'org-1',
      student_id: 'stu-other',
      start_date: '2026-10-20',
      end_date: '2026-10-20',
    },
    {
      id: 'leave-org2',
      org_id: 'org-2',
      student_id: 'stu-mine',
      start_date: '2026-10-20',
      end_date: '2026-10-20',
    },
  ];

  it('自己孩子的假：用假單的學生與日期偵測', async () => {
    vi.mocked(notifyLeaveStreaks).mockClear();
    const db = createMultiOrgDb({ leave_requests: leaves });
    const childDb = createChildDb(db.client as never, ['stu-mine'], 'org-1');
    expect(await childDb.checkLeaveStreak('leave-mine')).toBe(true);
    expect(notifyLeaveStreaks).toHaveBeenCalledWith(db.client, {
      orgId: 'org-1',
      studentId: 'stu-mine',
      from: '2026-10-20',
      to: '2026-10-22',
    });
  });

  it('別人孩子的 leaveId、別 org 的假、不是家長：一律不偵測', async () => {
    vi.mocked(notifyLeaveStreaks).mockClear();
    const db = createMultiOrgDb({ leave_requests: leaves });
    const mine = createChildDb(db.client as never, ['stu-mine'], 'org-1');
    const none = createChildDb(db.client as never, null, 'org-1');
    expect(await mine.checkLeaveStreak('leave-other')).toBe(false);
    expect(await mine.checkLeaveStreak('leave-org2')).toBe(false);
    expect(await none.checkLeaveStreak('leave-mine')).toBe(false);
    expect(notifyLeaveStreaks).not.toHaveBeenCalled();
  });
});

/** #1695：家長請假的稽核 —— 只有 scope 內孩子的假才寫，不帶個資 */
describe('createChildDb —— recordLeave', () => {
  const leaves = [
    {
      id: 'leave-mine',
      org_id: 'org-1',
      student_id: 'stu-mine',
      start_date: '2026-10-20',
      end_date: '2026-10-21',
    },
    {
      id: 'leave-other',
      org_id: 'org-1',
      student_id: 'stu-other',
      start_date: '2026-10-20',
      end_date: '2026-10-20',
    },
    {
      id: 'leave-org2',
      org_id: 'org-2',
      student_id: 'stu-mine',
      start_date: '2026-10-20',
      end_date: '2026-10-20',
    },
  ];
  /** logAudit 是背景寫入：收下它的 promise 再等完 */
  async function record(childDb: ReturnType<typeof createChildDb>, leaveId: string) {
    const pending: Promise<unknown>[] = [];
    const ok = await childDb.recordLeave(
      leaveId,
      { sessionCount: 3, retroactiveSessionCount: 1, skippedAttendedCount: 2 },
      'parent-1',
      (p) => pending.push(p),
    );
    await Promise.all(pending);
    return ok;
  }

  it('自己孩子的假：寫一筆 leave／create，actor 是 session 的使用者，日期讀 DB、不帶學生名', async () => {
    const db = createMultiOrgDb({ leave_requests: leaves, audit_logs: [] });
    const childDb = createChildDb(db.client as never, ['stu-mine'], 'org-1');

    expect(await record(childDb, 'leave-mine')).toBe(true);
    expect(db.rows('audit_logs')).toHaveLength(1);
    expect(db.rows('audit_logs')[0]).toMatchObject({
      org_id: 'org-1',
      user_id: 'parent-1',
      resource_type: 'leave',
      resource_id: 'leave-mine',
      resource_name: '家長請假 / 2026-10-20 ~ 2026-10-21',
      action: 'create',
      details: {
        submittedByRole: 'parent',
        sessionCount: 3,
        retroactiveSessionCount: 1,
        skippedAttendedCount: 2,
      },
    });
  });

  it('別人孩子的假、別 org 的假、不是家長：一律不寫', async () => {
    const db = createMultiOrgDb({ leave_requests: leaves, audit_logs: [] });
    const mine = createChildDb(db.client as never, ['stu-mine'], 'org-1');
    const none = createChildDb(db.client as never, null, 'org-1');

    expect(await record(mine, 'leave-other')).toBe(false);
    expect(await record(mine, 'leave-org2')).toBe(false);
    expect(await record(none, 'leave-mine')).toBe(false);
    expect(db.rows('audit_logs')).toHaveLength(0);
  });
});

/** #1731：家長 App 送出的申請通知分校管理員 —— 只有這次送出的、scope 內孩子的申請才發 */
describe('createChildDb —— notifyRequests', () => {
  const kid = { name: '林小華' };
  const tables = {
    enrollment_requests: [
      { id: 'er-mine', org_id: 'org-1', student_id: 'stu-mine', class_id: 'k1', students: kid },
      {
        id: 'er-other',
        org_id: 'org-1',
        student_id: 'stu-other',
        class_id: 'k1',
        students: { name: '別人' },
      },
      { id: 'er-org2', org_id: 'org-2', student_id: 'stu-mine', class_id: 'k9', students: kid },
    ],
    trial_requests: [
      { id: 'tr-b', org_id: 'org-1', student_id: 'stu-mine', course_id: 'c2', students: kid },
      { id: 'tr-a', org_id: 'org-1', student_id: 'stu-mine', course_id: 'c1', students: kid },
    ],
  };

  it('報名：自己孩子的一筆 → 發，班與學生名由這裡讀', async () => {
    vi.mocked(notifyNewApplication).mockClear();
    const db = createMultiOrgDb(tables);
    const childDb = createChildDb(db.client as never, ['stu-mine'], 'org-1');
    expect(await childDb.notifyRequests('enrollment', ['er-mine'])).toBe(true);
    expect(notifyNewApplication).toHaveBeenCalledWith(db.client, {
      orgId: 'org-1',
      applicationId: 'er-mine',
      source: 'parent',
      kind: 'enrollment',
      studentName: '林小華',
      classIds: ['k1'],
      requestCount: 1,
    });
  });

  it('試聽一次兩門：合成一則，識別碼取 id 最小的那筆（重送同一批同一個鍵）', async () => {
    vi.mocked(notifyNewApplication).mockClear();
    const db = createMultiOrgDb(tables);
    const childDb = createChildDb(db.client as never, ['stu-mine'], 'org-1');
    expect(await childDb.notifyRequests('trial', ['tr-b', 'tr-a'])).toBe(true);
    expect(notifyNewApplication).toHaveBeenCalledTimes(1);
    expect(notifyNewApplication).toHaveBeenCalledWith(
      db.client,
      expect.objectContaining({
        applicationId: 'tr-a',
        kind: 'trial',
        courseIds: ['c1', 'c2'],
        requestCount: 2,
      }),
    );
  });

  it('混了別人孩子的、別 org 的、不是家長：一律不發', async () => {
    vi.mocked(notifyNewApplication).mockClear();
    const db = createMultiOrgDb(tables);
    const mine = createChildDb(db.client as never, ['stu-mine'], 'org-1');
    const none = createChildDb(db.client as never, null, 'org-1');
    expect(await mine.notifyRequests('enrollment', ['er-mine', 'er-other'])).toBe(false);
    expect(await mine.notifyRequests('enrollment', ['er-org2'])).toBe(false);
    expect(await mine.notifyRequests('enrollment', [])).toBe(false);
    expect(await none.notifyRequests('enrollment', ['er-mine'])).toBe(false);
    expect(notifyNewApplication).not.toHaveBeenCalled();
  });
});
