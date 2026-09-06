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
