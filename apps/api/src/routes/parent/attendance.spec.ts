import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { ATTENDANCE_SELECT } from '../../lib/attendance-query';
import { createChildDb } from '../../lib/child-db';
import { createMultiOrgDb } from '../../test-utils/multi-org-db';

import attendanceRoute from './attendance';

/**
 * 只實作這支 route 用得到的鏈：`.eq().gte()...` 一路回自己，await 時
 * 依表名決定回傳內容。這組測試不重測 attendance-query.ts 的映射邏輯
 * （那有自己的單元測試），只釘住這支 route 特有的東西：角色擋、
 * 越權指名擋、`.eq('student_id', childId)` 有沒有疊上去、月度統計走了
 * 獨立查詢。
 */
function chainable(
  resolve: (calls: Record<string, unknown>) => { data: unknown; error: unknown; count?: number },
) {
  const calls: Record<string, unknown> = {};
  const obj: any = {
    eq: (col: string, value: unknown) => {
      calls[`eq:${col}`] = value;
      return obj;
    },
    gte: (col: string, value: unknown) => {
      calls[`gte:${col}`] = value;
      return obj;
    },
    lte: (col: string, value: unknown) => {
      calls[`lte:${col}`] = value;
      return obj;
    },
    in: (col: string, value: unknown) => {
      calls[`in:${col}`] = value;
      return obj;
    },
    range: () => obj,
    order: () => obj,
    then: (onfulfilled: (value: unknown) => unknown) =>
      Promise.resolve(resolve(calls)).then(onfulfilled),
  };
  return obj;
}

function fakeChildDb(rows: unknown[], monthlyCounts: { absent: number; onLeave: number }) {
  const selects: Array<{ table: string; cols: string; head: boolean }> = [];

  const db = {
    selects,
    from: (table: string) => ({
      select: (cols: string, opts?: { head?: boolean }) => {
        selects.push({ table, cols, head: Boolean(opts?.head) });
        if (opts?.head) {
          // 缺席與請假現在是兩支獨立查詢 —— 依 `.eq('status', ...)` 分流，
          // 不然這個假 DB 會讓兩支查詢回同一個數字，測不出「真的分開回」。
          return chainable((calls) => {
            const status = calls['eq:status'];
            const count =
              status === 'absent'
                ? monthlyCounts.absent
                : status === 'on_leave'
                  ? monthlyCounts.onLeave
                  : 0;
            return { data: null, error: null, count };
          });
        }
        return chainable(() => ({ data: rows, error: null, count: rows.length }));
      },
    }),
  };

  return db;
}

function appWith(roles: string[], studentScope: readonly string[] | null, childDb: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', roles);
    set('studentScope', studentScope);
    set('childDb', childDb);
    await next();
  });
  app.route('/', attendanceRoute as unknown as Hono);
  return app;
}

const ROW = {
  id: 'a1',
  org_id: 'org-1',
  student_id: '00000000-0000-0000-0000-000000000001',
  event_id: 'e1',
  status: 'absent',
  note: '請假原因',
  recorded_by: 'staff-user-id',
  recorded_by_role: 'teacher',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  students: { name: '王小明' },
  events: {
    event_date: '2026-09-01',
    start_time: '09:00',
    end_time: '10:00',
    campuses: { name: '本校' },
    sessions: [{ classes: { name: '數學 A' } }],
  },
};

describe('GET /api/me/attendance', () => {
  it('不是家長身分回 403', async () => {
    const res = await appWith(
      ['teacher'],
      ['00000000-0000-0000-0000-000000000001'],
      fakeChildDb([], { absent: 0, onLeave: 0 }),
    ).request('/?childId=00000000-0000-0000-0000-000000000001');
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'NOT_PARENT' });
  });

  it('childId 不在 studentScope 裡回 403，不是空清單', async () => {
    const res = await appWith(
      ['parent'],
      ['00000000-0000-0000-0000-000000000002'],
      fakeChildDb([ROW], { absent: 1, onLeave: 0 }),
    ).request('/?childId=00000000-0000-0000-0000-000000000001');
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'CHILD_OUT_OF_SCOPE' });
  });

  it('是家長且孩子在範圍內時回列表，recordedBy/recordedByRole 不外流', async () => {
    const res = await appWith(
      ['parent'],
      ['00000000-0000-0000-0000-000000000001'],
      fakeChildDb([ROW], { absent: 3, onLeave: 2 }),
    ).request('/?childId=00000000-0000-0000-0000-000000000001');

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };

    expect(body.data).toHaveLength(1);
    expect(body.data[0]).not.toHaveProperty('recordedBy');
    expect(body.data[0]).not.toHaveProperty('recordedByRole');
    expect(body.data[0]).toMatchObject({
      id: 'a1',
      status: 'absent',
      className: '數學 A',
      note: '請假原因',
    });
    // 月度統計走獨立查詢，不是從當頁筆數算出來的；缺席與請假分開回
    // （不合計），兩個數字刻意不同，證明真的是兩支查詢而不是同一個數字複製兩份
    expect(body.meta).toMatchObject({ monthlyAbsentCount: 3, monthlyOnLeaveCount: 2 });
  });
});

/**
 * **對 embed 欄位下條件，那張表一定要在 `select` 裡。**（#528）
 *
 * 這兩支「本月缺席／請假次數」的 count 查詢原本是：
 *
 * ```ts
 * .select('id', { count: 'exact', head: true }).gte('events.event_date', monthStart())
 * ```
 *
 * PostgREST 對它回 **400 `PGRST108`**（`'events' is not an embedded resource in this
 * request`）—— 也就是 **`GET /api/me/attendance` 對每一個家長、每一次呼叫都 500**，
 * 而這支 spec 一直是綠的：**替身把 select 字串整個忽略（參數名就是 `_cols`）**，
 * 所以它分不出「有 embed」與「沒 embed」。
 *
 * 修法是把 `events!inner(event_date)` 帶進 select。**`!inner` 不是裝飾** ——
 * 少了它，條件會靜靜地什麼都不篩（`lib/session-summary.ts` 的實測表）。
 * 同一個知識點的兩種失敗方向：**沒 embed 是大聲的 400，有 embed 沒 `!inner` 是安靜的全回。**
 */
describe('GET /api/me/attendance —— 月度統計對 events 下條件，就必須 embed events', () => {
  it('兩支 count 查詢的 select 都帶著 events!inner', async () => {
    const childDb = fakeChildDb([], { absent: 1, onLeave: 2 });
    const childId = '00000000-0000-0000-0000-000000000001';
    const res = await appWith(['parent'], [childId], childDb).request(`/?childId=${childId}`);

    expect(res.status).toBe(200);

    const countSelects = childDb.selects.filter((call) => call.head);
    expect(countSelects).toHaveLength(2);
    for (const call of countSelects) {
      expect(call.cols).toContain('events!inner');
    }
  });
});

/**
 * #1695 第 4 張：請假的堂帶「誰登記的」與原因（計畫席 10-19 裁 (A)）。
 * 用真的 `createChildDb` ＋會套條件的替身：拿掉 `.eq('student_id', childId)`，兄弟姊妹的假就會混進來。
 */
describe('GET /api/me/attendance —— 請假的堂：誰登記的、原因', () => {
  const ORG = 'org-1';
  const ME = '00000000-0000-0000-0000-0000000000a1';
  const SIBLING = '00000000-0000-0000-0000-0000000000a2';
  const STRANGER = '00000000-0000-0000-0000-0000000000b1';

  const record = (id: string, date: string, status: string) => ({
    id,
    org_id: ORG,
    student_id: ME,
    event_id: `ev-${id}`,
    status,
    note: null,
    recorded_by: 'x',
    recorded_by_role: 'admin',
    created_at: `${date}T00:00:00Z`,
    updated_at: `${date}T00:00:00Z`,
    students: { name: '林小華' },
    events: {
      event_date: date,
      start_time: '18:00',
      end_time: '20:00',
      campuses: { name: '本校' },
      sessions: [{ id: `ses-${id}`, status: 'scheduled', classes: { name: '數學 A' } }],
    },
  });
  const leave = (
    id: string,
    studentId: string,
    date: string,
    role: 'parent' | 'admin',
    reason: string,
    window: { startTime?: string; endTime?: string; boundSessionIds?: string[] } = {},
  ) => ({
    id,
    org_id: ORG,
    student_id: studentId,
    start_date: date,
    end_date: date,
    start_time: window.startTime ?? null,
    end_time: window.endTime ?? null,
    reason,
    submitted_by: 'u',
    submitted_by_role: role,
    leave_request_sessions: (window.boundSessionIds ?? []).map((id) => ({
      session_id: id,
      sessions: { session_date: date },
    })),
  });

  const db = () =>
    createMultiOrgDb({
      attendance_records: [
        record('by-parent', '2026-10-20', 'on_leave'),
        record('by-school', '2026-10-21', 'on_leave'),
        // 這個孩子 10/22 沒有假單（例如老師直接點成請假）；同一天兄弟姊妹跟別人家的孩子有
        record('no-own-leave', '2026-10-22', 'on_leave'),
        record('present', '2026-10-20', 'present'),
        // 審核席：同一天兩張不同時段的假，18:00 那堂要對到 18–20 那張（時間有參與對應）
        record('evening', '2026-10-23', 'on_leave'),
        // 審核席：同一天兩堂、同一個時段，綁定型的假只綁 A 堂（sessionId 有參與對應）
        record('bound-a', '2026-10-24', 'on_leave'),
        record('bound-b', '2026-10-24', 'on_leave'),
      ],
      leave_requests: [
        leave('l-mine', ME, '2026-10-20', 'parent', '看牙醫'),
        leave('l-school', ME, '2026-10-21', 'admin', '內部：家長電話態度不佳'),
        leave('l-sibling', SIBLING, '2026-10-22', 'parent', '弟弟的原因'),
        leave('l-stranger', STRANGER, '2026-10-22', 'parent', '別人家的原因'),
        // 這張蓋到 present 那堂的日期，但出席的堂不帶假單資訊
        leave('l-present-day', ME, '2026-10-20', 'parent', '看牙醫'),
        // 放在前面：不看時間的話 find 會先拿到這張
        leave('l-afternoon', ME, '2026-10-23', 'parent', '下午看醫生', {
          startTime: '14:00:00',
          endTime: '16:00:00',
        }),
        leave('l-evening', ME, '2026-10-23', 'admin', '內部：晚上那堂', {
          startTime: '18:00:00',
          endTime: '20:00:00',
        }),
        leave('l-bound-a', ME, '2026-10-24', 'parent', '只請 A 堂', {
          boundSessionIds: ['ses-bound-a'],
        }),
      ],
    });

  async function get(fixture = db()) {
    const childDb = createChildDb(fixture.client as never, [ME, SIBLING], ORG);
    const res = await appWith(['parent'], [ME, SIBLING], childDb).request(`/?childId=${ME}`);
    const text = await res.text();
    const body = JSON.parse(text) as { data: Array<Record<string, unknown>> };
    const byId = Object.fromEntries(
      (body.data ?? []).map((r) => [r['id'], [r['leaveSubmittedBy'], r['leaveReason']]]),
    );
    return { status: res.status, text, byId };
  }

  it('家長送的：parent＋原因；補習班登記的：school、原因 null；出席的堂不帶', async () => {
    const { status, byId } = await get();
    expect(status).toBe(200);
    expect(byId['by-parent']).toEqual(['parent', '看牙醫']);
    expect(byId['by-school']).toEqual(['school', null]);
    expect(byId['present']).toEqual([null, null]);
  });

  it('補習班登記的原因不在回應裡（API 就不回，不是只在前端藏）', async () => {
    const { text } = await get();
    expect(text).not.toContain('內部：家長電話態度不佳');
  });

  it('只讀這個孩子的假：兄弟姊妹、別人家孩子同一天的假不會套到這堂', async () => {
    const { text, byId } = await get();
    expect(byId['no-own-leave']).toEqual([null, null]);
    expect(text).not.toContain('弟弟的原因');
    expect(text).not.toContain('別人家的原因');
  });

  it('同一天家長 14–16、補習班 18–20：18:00 那堂對到補習班那張 → school、原因 null', async () => {
    const { text, byId } = await get();
    expect(byId['evening']).toEqual(['school', null]);
    expect(text).not.toContain('下午看醫生');
  });

  it('綁定堂次的假只對到綁的那一堂：同一天同時段的另一堂不帶', async () => {
    const { byId } = await get();
    expect(byId['bound-a']).toEqual(['parent', '只請 A 堂']);
    expect(byId['bound-b']).toEqual([null, null]);
  });

  // 替身不看 select 欄位（一律回整列），所以上一條守不住「select 有沒有撈 sessions.id」。
  // 沒撈到的話 sessionId 是 null ＝日層級查詢，綁定型的假會套到當天每一堂（leave-covers-session.ts）
  it('出勤查詢有撈 sessions 的 id（綁定型假靠它對堂）', () => {
    expect(ATTENDANCE_SELECT.replace(/\s+/g, '')).toContain('sessions(id,');
  });

  it('讀假單失敗：500（不回半套資料）', async () => {
    const fixture = db();
    const client = fixture.client as { from: (table: string) => Record<string, unknown> };
    const realFrom = client.from.bind(client);
    const failing: Record<string, unknown> = {
      eq: () => failing,
      in: () => failing,
      lte: () => failing,
      gte: () => failing,
      then: (ok: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: { message: 'boom' } }).then(ok),
    };
    vi.spyOn(client, 'from').mockImplementation((table: string) =>
      table === 'leave_requests' ? { select: () => failing } : realFrom(table),
    );
    const { status } = await get(fixture);
    expect(status).toBe(500);
  });
});
