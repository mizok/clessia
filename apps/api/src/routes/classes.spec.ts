import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as classesRoute from './classes';

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
 * M8 稽核發現：`DELETE /api/classes/:id` 手動 `enrollments.delete().eq('class_id', id)`
 * 完全繞過 enrollments.ts 自己的刪除守門，而底下的報名可能掛著已收費的
 * session_packs（ON DELETE CASCADE）。跟 enrollments.ts 共用同一支
 * `checkEnrollmentSessionPacks`（見 lib/enrollment-session-pack-guard.ts），
 * 這裡釘住那個「無辜」情境：班級沒有過去課堂、底下報名有 session_pack，
 * 一樣要回 409，不能刪。
 */
describe('DELETE /api/classes/:id —— session_packs 守門（真的打路由）', () => {
  interface DeleteRouteFixture {
    readonly enrollmentIds: string[];
    readonly sessionPackCount: number;
  }

  function createDeleteRouteApp(fixture: DeleteRouteFixture) {
    let classesTouched = false;

    const sessionsQuery = {
      select: () => sessionsQuery,
      eq: () => sessionsQuery,
      in: () => sessionsQuery,
      lt: () => sessionsQuery,
      // #762：過去課堂的判定改成 `session_date < today OR status = 'completed'`
      or: () => sessionsQuery,
      limit: () => sessionsQuery,
      then: (onfulfilled?: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(onfulfilled ?? undefined),
    };

    const enrollmentsQuery = {
      select: () => enrollmentsQuery,
      eq: () => enrollmentsQuery,
      then: (onfulfilled?: (value: unknown) => unknown) =>
        Promise.resolve({
          data: fixture.enrollmentIds.map((id) => ({ id })),
          error: null,
        }).then(onfulfilled ?? undefined),
    };

    const sessionPacksQuery = {
      select: () => sessionPacksQuery,
      eq: () => sessionPacksQuery,
      in: () => sessionPacksQuery,
      then: (onfulfilled?: (value: unknown) => unknown) =>
        Promise.resolve({ data: null, count: fixture.sessionPackCount, error: null }).then(
          onfulfilled ?? undefined,
        ),
    };

    const supabase = {
      from(table: string) {
        if (table === 'sessions') return sessionsQuery;
        if (table === 'enrollments') return enrollmentsQuery;
        if (table === 'session_packs') return sessionPacksQuery;
        // 只有走到 409 之前的表才會被查到；一旦這個測試意外走到 cascade delete
        // 之後的表，代表守門沒有真的擋下，讓它直接爆炸比靜靜回一個假資料更誠實。
        classesTouched = true;
        throw new Error(`Unsupported table in this fixture: ${table}`);
      },
    };

    const app = new Hono();
    app.use('/api/classes/*', async (c, next) => {
      const context = c as unknown as { set: (key: string, value: unknown) => void };
      context.set('supabase', supabase);
      context.set('orgId', 'org-1');
      context.set('userId', 'user-1');
      await next();
    });
    app.route('/api/classes', classesRoute.default);

    return { app, wentPastGuard: () => classesTouched };
  }

  it('班級沒有過去課堂、但底下報名有 session_pack —— 仍要回 409，不能刪', async () => {
    const { app, wentPastGuard } = createDeleteRouteApp({
      enrollmentIds: ['enrollment-1'],
      sessionPackCount: 1,
    });

    const res = await app.request('/api/classes/22222222-2222-4222-8222-222222222222', {
      method: 'DELETE',
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: '此班級已有學生購買堂數包，無法刪除，請改為停用',
      code: 'HAS_SESSION_PACK',
    });
    expect(wentPastGuard()).toBe(false);
  });
});

/**
 * 時區第三批 PR A：`DELETE /api/classes/:id`（單筆）與 `DELETE /api/classes/batch`
 * 的「過去課堂」守門原本用 `new Date().toISOString().slice(0, 10)`（UTC）算「今天」，
 * 在台北時間 00:00–08:00 之間會算成前一天。
 *
 * **這是 M8 洞的迴歸測試**：一個班有「台北昨天」的課堂，在 UTC 還是前一天傍晚、
 * 台北已經跨到隔天凌晨的時刻呼叫刪除——修之前這個組合會被判定成「沒有過去課堂」
 * 而放行，修之後（收斂進 `checkClassesPastSessions`，用台北時間）要回 409。
 */
describe('DELETE /api/classes —— 台北凌晨那個窗（M8 洞的迴歸測試）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createPastSessionsApp(pastSessionRows: Array<{ class_id: string }>) {
    let touchedBeyondGuard = false;

    const sessionsQuery = {
      select: () => sessionsQuery,
      eq: () => sessionsQuery,
      in: () => sessionsQuery,
      lt: () => sessionsQuery,
      // #762：過去課堂的判定改成 `session_date < today OR status = 'completed'`
      or: () => sessionsQuery,
      limit: () => sessionsQuery,
      then: (onfulfilled?: (value: unknown) => unknown) =>
        Promise.resolve({ data: pastSessionRows, error: null }).then(onfulfilled ?? undefined),
    };

    const supabase = {
      from(table: string) {
        if (table === 'sessions') return sessionsQuery;
        // 409 之前只會查 sessions；查到別的表代表守門沒有真的擋下
        touchedBeyondGuard = true;
        throw new Error(`Unsupported table in this fixture: ${table}`);
      },
    };

    const app = new Hono();
    app.use('/api/classes/*', async (c, next) => {
      const context = c as unknown as { set: (key: string, value: unknown) => void };
      context.set('supabase', supabase);
      context.set('orgId', 'org-1');
      context.set('userId', 'user-1');
      await next();
    });
    app.route('/api/classes', classesRoute.default);

    return { app, wentPastGuard: () => touchedBeyondGuard };
  }

  it('單筆刪除：班級有台北昨天的課堂，UTC 還在前一天傍晚時呼叫 —— 要回 409，不能刪', async () => {
    // 台北 2026-09-06T01:00:00+08:00 = UTC 2026-09-05T17:00:00Z，#402 出事的那個窗
    vi.setSystemTime(new Date('2026-09-05T17:00:00Z'));

    const classId = '33333333-3333-4333-8333-333333333333';
    const { app, wentPastGuard } = createPastSessionsApp([{ class_id: classId }]);

    const res = await app.request(`/api/classes/${classId}`, { method: 'DELETE' });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: '此班級已有歷史課堂記錄，無法刪除，請改為停用',
      code: 'HAS_PAST_SESSIONS',
    });
    expect(wentPastGuard()).toBe(false);
  });

  it('批次刪除：同一個窗口，班級有台北昨天的課堂 —— 要被跳過，不能刪', async () => {
    vi.setSystemTime(new Date('2026-09-05T17:00:00Z'));

    const classId = '44444444-4444-4444-8444-444444444444';
    const { app, wentPastGuard } = createPastSessionsApp([{ class_id: classId }]);

    const res = await app.request('/api/classes/batch', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [classId] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 0, deletedIds: [], skipped: 1 });
    expect(wentPastGuard()).toBe(false);
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
