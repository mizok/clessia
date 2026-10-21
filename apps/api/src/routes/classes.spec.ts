import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as classesRoute from './classes';

const deleteClassesMock = vi.hoisted(() => vi.fn());
const getAuthPool = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('../lib/class-delete', () => ({ deleteClasses: deleteClassesMock }));
vi.mock('../lib/get-auth', () => ({ getAuth: () => ({ pool: getAuthPool.value }) }));

describe('applyClassDetailScheduleScope', () => {
  it('only scopes schedules by class_id', () => {
    const applyClassDetailScheduleScope = (classesRoute as Record<string, unknown>)[
      'applyClassDetailScheduleScope'
    ] as
      | (<T extends { eq: (column: string, value: unknown) => T }>(query: T, classId: string) => T)
      | undefined;

    expect(applyClassDetailScheduleScope).toBeTypeOf('function');

    const eq = vi.fn();
    const query = { eq } as { eq: (column: string, value: unknown) => typeof query };
    eq.mockReturnValue(query);

    applyClassDetailScheduleScope?.(query, 'class-1');

    expect(eq).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('class_id', 'class-1');
  });
});

/**
 * `classes.uses_contact_book` 是國小／國中模式的開關（contact-book-rules 規則 2）。
 * 欄位在 migration 20260829100000 建好了，但 route 一直沒把它讀出來也沒讓人寫 ——
 * 管理端的班級設定與聯絡簿頁都需要它，沒有這條管線那個欄位等於不存在。
 */
describe('mapClass —— uses_contact_book', () => {
  const mapClass = (classesRoute as Record<string, unknown>)['mapClass'] as
    ((row: Record<string, unknown>) => Record<string, unknown>) | undefined;

  const row = {
    id: 'class-1',
    org_id: 'org-1',
    campus_id: 'campus-1',
    course_id: 'course-1',
    name: '數學班 A',
    max_students: 20,
    next_class_id: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('開了聯絡簿的班回 true', () => {
    expect(mapClass).toBeTypeOf('function');
    expect(mapClass?.({ ...row, uses_contact_book: true })['usesContactBook']).toBe(true);
  });

  // 預設 false（現況全是紙本），而且**不能是 undefined** —— 前端拿 undefined
  // 去畫開關會變成不確定狀態
  it('沒開的班回 false，不是 undefined', () => {
    expect(mapClass?.({ ...row, uses_contact_book: false })['usesContactBook']).toBe(false);
  });

  it('欄位缺席時退回 false', () => {
    expect(mapClass?.(row)['usesContactBook']).toBe(false);
  });
});

/**
 * #1652：刪班級（單筆與批次）的範圍、守門、刪除都在 `lib/class-delete.ts` 的一個 pg 交易裡，
 * SQL 語意（org、分校範圍、過去課堂、堂數包、帳單明細、FK 回滾）由
 * `contract/class-delete.contract.ts` 對真 Postgres 驗；台北日期那個窗（M8）由 `class-delete.spec.ts` 驗。
 * 這裡只釘路由把交易結果對成什麼 HTTP。
 */
describe('DELETE /api/classes —— 交易結果 → HTTP（#1652）', () => {
  const CLASS = '22222222-2222-4222-8222-222222222222';
  const done = (
    over: Partial<Record<'deletedIds' | 'pastSessionIds' | 'sessionPackIds', string[]>>,
  ) => ({
    status: 'done' as const,
    deletedIds: [],
    pastSessionIds: [],
    sessionPackIds: [],
    ...over,
  });

  function app(pool: unknown = {}) {
    getAuthPool.value = pool;
    const supabase = {
      from: () => {
        const q: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'in', 'insert']) q[m] = () => q;
        // 班在呼叫者的分校範圍內（#1797 的寫入守衛會先比分校）
        q['maybeSingle'] = () =>
          Promise.resolve({ data: { id: CLASS, name: 'x', campus_id: 'campus-1' }, error: null });
        q['then'] = (ok: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(ok);
        return q;
      },
    };
    const a = new Hono();
    a.use('/api/classes/*', async (c, next) => {
      const context = c as unknown as { set: (key: string, value: unknown) => void };
      context.set('supabase', supabase);
      context.set('orgId', 'org-1');
      context.set('userId', 'user-1');
      context.set('campusScope', ['campus-1']);
      await next();
    });
    a.route('/api/classes', classesRoute.default);
    return a;
  }
  const del = (a: Hono) => a.request(`/api/classes/${CLASS}`, { method: 'DELETE' });
  const batch = (a: Hono) =>
    a.request('/api/classes/batch', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [CLASS] }),
    });

  afterEach(() => deleteClassesMock.mockReset());

  it('帶 org、分校範圍與模式進交易', async () => {
    deleteClassesMock.mockResolvedValue(done({ deletedIds: [CLASS] }));
    expect((await del(app())).status).toBe(200);
    expect(deleteClassesMock).toHaveBeenLastCalledWith(expect.anything(), {
      orgId: 'org-1',
      ids: [CLASS],
      scope: ['campus-1'],
      onBlocked: 'abort',
    });
    expect((await batch(app())).status).toBe(200);
    expect(deleteClassesMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ onBlocked: 'skip' }),
    );
  });

  it.each([
    ['not-found', { status: 'not-found' }, 404, 'NOT_FOUND'],
    [
      'has-invoice-items',
      { status: 'has-invoice-items', classIds: [CLASS] },
      409,
      'HAS_INVOICE_ITEMS',
    ],
    ['in-use（FK）', { status: 'in-use' }, 409, 'IN_USE'],
    ['過去課堂', done({ pastSessionIds: [CLASS] }), 409, 'HAS_PAST_SESSIONS'],
    ['堂數包', done({ sessionPackIds: [CLASS] }), 409, 'HAS_SESSION_PACK'],
  ])('單筆：%s → %i %s', async (_l, outcome, status, code) => {
    deleteClassesMock.mockResolvedValue(outcome);
    const res = await del(app());
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
  });

  it('批次：有帳單 → 409 並標出哪幾班；被略過的算 skipped', async () => {
    deleteClassesMock.mockResolvedValue({ status: 'has-invoice-items', classIds: [CLASS] });
    const blocked = await batch(app());
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: 'HAS_INVOICE_ITEMS', classIds: [CLASS] });

    deleteClassesMock.mockResolvedValue(done({ pastSessionIds: [CLASS] }));
    const skipped = await batch(app());
    expect(await skipped.json()).toEqual({ deleted: 0, deletedIds: [], skipped: 1 });
  });

  it('交易丟例外 → 500，不是 404', async () => {
    deleteClassesMock.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await del(app())).status).toBe(500);
    expect((await batch(app())).status).toBe(500);
  });

  it('pool 不在 → 500，不退回沒有交易的舊寫法', async () => {
    const res = await del(app(null));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'DB_POOL_UNAVAILABLE' });
    expect(deleteClassesMock).not.toHaveBeenCalled();
  });
});

describe('findCoveredMakeupTargets（#499 決策 5.5 的 uncancel 守衛）', () => {
  const findCoveredMakeupTargets = (classesRoute as Record<string, unknown>)[
    'findCoveredMakeupTargets'
  ] as
    | ((
        targets: ReadonlyArray<{ id: string; makeup_for_session_id: string | null }>,
        siblings: ReadonlyArray<{
          id: string;
          makeup_for_session_id: string | null;
          status: string;
        }>,
      ) => Map<string, string>)
    | undefined;

  it('復課的補課，其目標已經被另一堂有效的補課佔住 —— 擋下並指出是誰', () => {
    expect(findCoveredMakeupTargets).toBeTypeOf('function');

    const covered = findCoveredMakeupTargets!(
      [{ id: 'makeup-a', makeup_for_session_id: 'cancelled-1' }],
      [{ id: 'makeup-b', makeup_for_session_id: 'cancelled-1', status: 'scheduled' }],
    );

    expect(covered.get('makeup-a')).toBe('makeup-b');
  });

  // 排除條件跟部分唯一索引的述詞逐字一致：`status <> 'cancelled'`。
  // 停掉的補課不佔位子 —— 索引也不會擋，所以這裡擋了就是誤擋。
  it('佔住目標的那堂本身已停課 —— 不算佔住，放行', () => {
    const covered = findCoveredMakeupTargets!(
      [{ id: 'makeup-a', makeup_for_session_id: 'cancelled-1' }],
      [{ id: 'makeup-b', makeup_for_session_id: 'cancelled-1', status: 'cancelled' }],
    );

    expect(covered.size).toBe(0);
  });

  it('自己不算佔住自己', () => {
    const covered = findCoveredMakeupTargets!(
      [{ id: 'makeup-a', makeup_for_session_id: 'cancelled-1' }],
      [{ id: 'makeup-a', makeup_for_session_id: 'cancelled-1', status: 'cancelled' }],
    );

    expect(covered.size).toBe(0);
  });

  it('一般課堂（沒有補課連結）完全不受這道守衛影響', () => {
    const covered = findCoveredMakeupTargets!(
      [{ id: 'plain', makeup_for_session_id: null }],
      [{ id: 'other', makeup_for_session_id: null, status: 'scheduled' }],
    );

    expect(covered.size).toBe(0);
  });
});

/**
 * **#854：排課指定任課老師不驗分校／科目，而代課與批次指派都驗。**
 *
 * 三處讀同一張表（`staff_campuses`）、一處漏 —— 行政可以把 A 校老師排進 B 校的課，
 * **那堂課從此找不到代課老師**（代課的候選讀的正是那張表），
 * 而畫面上那堂課看起來完全正常。#849 在本機看到的就是這個形狀，只是成因是 seed。
 *
 * ⚠️ **只在 `teacherId` 真的變動時驗** —— 前端的排課對話框把既有 `teacherId`
 * 原封不動送回來（`class-form-dialog.component.ts:364`，而它的老師下拉在 D4 已被移除），
 * 所以「改個上課時間」也會帶著舊老師。不分變動與否一律驗的話，
 * **歷史資料裡任何一筆不合格的排課會從此無法編輯** —— 那不是擋，那是鎖死。
 */
describe('PUT /api/classes/:id/schedules/:sid —— 任課老師的資格（#854）', () => {
  const CLASS_ID = '00000000-0000-0000-0000-0000000000c1';
  const SCHEDULE_ID = '00000000-0000-0000-0000-0000000000e1';
  const OWN_TEACHER = '00000000-0000-0000-0000-0000000000a1';
  const OTHER_CAMPUS_TEACHER = '00000000-0000-0000-0000-0000000000a2';
  const CAMPUS_A = '00000000-0000-0000-0000-0000000000f1';
  const SUBJECT_MATH = '00000000-0000-0000-0000-0000000000b1';

  /** `eligibleStaffId` 是「被指派到 CAMPUS_A 且有 SUBJECT_MATH」的那一位 */
  function createApp(options: { existingTeacherId?: string | null } = {}) {
    const updates: Array<Record<string, unknown>> = [];

    const supabase = {
      from(table: string) {
        const builder: Record<string, unknown> = {};
        const chain = () => builder as never;
        Object.assign(builder, {
          select: () => chain(),
          eq: () => chain(),
          in: () => chain(),
          order: () => chain(),
          limit: () => chain(),
          update: (payload: Record<string, unknown>) => {
            updates.push(payload);
            return chain();
          },
          maybeSingle: () =>
            Promise.resolve({
              data:
                table === 'schedules'
                  ? {
                      id: SCHEDULE_ID,
                      class_id: CLASS_ID,
                      teacher_id: options.existingTeacherId ?? OWN_TEACHER,
                    }
                  : table === 'classes'
                    ? { id: CLASS_ID, campus_id: CAMPUS_A, course_id: 'course-1' }
                    : table === 'courses'
                      ? { subject_id: SUBJECT_MATH }
                      : table === 'staff'
                        ? { id: 'x', user_id: 'u1', status: 'active' }
                        : table === 'user_roles'
                          ? { role: 'teacher' }
                          : null,
              error: null,
            }),
          single: () =>
            Promise.resolve({
              data: { id: SCHEDULE_ID, class_id: CLASS_ID, teacher_id: OWN_TEACHER },
              error: null,
            }),
          then: (resolve: (value: unknown) => unknown) =>
            resolve({
              // 關鍵的兩張表：只有 OWN_TEACHER 被指派到 CAMPUS_A
              data:
                table === 'staff_subjects'
                  ? [{ subject_id: SUBJECT_MATH }]
                  : table === 'staff_campuses'
                    ? // 由測試決定這位老師有沒有 CAMPUS_A —— 見下面每條的註解
                      ((globalThis as { __campusRows?: unknown[] }).__campusRows ?? [])
                    : [],
              count: 0,
              error: null,
            }),
        });

        return builder;
      },
    };

    const app = new Hono();
    app.use('/api/classes/*', async (c, next) => {
      const context = c as unknown as { set: (k: string, v: unknown) => void };
      context.set('supabase', supabase);
      context.set('orgId', 'org-1');
      context.set('userId', 'user-1');
      context.set('campusScope', null);
      await next();
    });
    app.route('/api/classes', classesRoute.default as unknown as Hono);

    return { app, updates };
  }

  const put = (app: Hono, body: unknown) =>
    app.request(`/api/classes/${CLASS_ID}/schedules/${SCHEDULE_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('把別校的老師排進來 → 409，訊息說得出該去哪裡改', async () => {
    (globalThis as { __campusRows?: unknown[] }).__campusRows = []; // 這位老師沒有 CAMPUS_A
    const { app, updates } = createApp();

    const res = await put(app, { weekday: 1, teacherId: OTHER_CAMPUS_TEACHER });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('TEACHER_NOT_ELIGIBLE');
    expect(body.error).toContain('人員管理');
    // **擋下來就不能寫進去** —— 只回 409 而照樣 update 的話比不擋更糟
    expect(updates).toHaveLength(0);
  });

  it('本校老師 → 照舊通過', async () => {
    (globalThis as { __campusRows?: unknown[] }).__campusRows = [{ campus_id: CAMPUS_A }];
    const { app } = createApp();

    const res = await put(app, { weekday: 1, teacherId: OWN_TEACHER });

    expect(res.status).not.toBe(409);
  });

  /**
   * **這一條是「既有已排的不回溯」的真正含意** —— 不只是不改歷史資料，
   * 而是擋下的規則不能讓既有資料無法編輯。
   */
  it('只改時間、teacherId 沒變 → 不驗資格（否則歷史資料會鎖死）', async () => {
    (globalThis as { __campusRows?: unknown[] }).__campusRows = []; // 這位老師「現在」不合格
    const { app } = createApp({ existingTeacherId: OTHER_CAMPUS_TEACHER });

    // 送的 teacherId 跟既有的一樣 —— 前端就是這樣送的
    const res = await put(app, { weekday: 3, teacherId: OTHER_CAMPUS_TEACHER });

    expect(res.status).not.toBe(409);
  });

  it('取消指派（teacherId: null）不驗資格', async () => {
    (globalThis as { __campusRows?: unknown[] }).__campusRows = [];
    const { app } = createApp();

    const res = await put(app, { weekday: 1, teacherId: null });

    expect(res.status).not.toBe(409);
  });
});
