import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import sessionsApp from './sessions';

import {
  buildBatchSessionChangeInserts,
  buildSessionCreationHistory,
  buildSingleSessionChangeInsert,
  mapSessionChange,
  mapSessionMakeup,
  normalizeRelationRow,
  sessionListSelect,
  SESSION_CHANGES_SELECT,
} from './sessions';

describe('session history mapping', () => {
  it('builds a creation history entry for session creation fallback', () => {
    const result = buildSessionCreationHistory({
      sessionId: '11111111-1111-1111-1111-111111111111',
      sessionCreatedAt: '2026-03-01T08:00:00.000Z',
      createdByName: '教務主任',
    });

    expect(result).toMatchObject({
      id: '11111111-1111-1111-1111-111111111111',
      changeType: 'creation',
      operationSource: null,
      createdByName: '教務主任',
      createdAt: '2026-03-01T08:00:00.000Z',
    });
  });

  it('maps original teacher and operation source metadata for substitute changes', () => {
    expect(SESSION_CHANGES_SELECT).toContain('original_teacher_id');
    expect(SESSION_CHANGES_SELECT).toContain('original_teacher_name');
    expect(SESSION_CHANGES_SELECT).toContain('operation_source');

    const result = mapSessionChange({
      id: '11111111-1111-1111-1111-111111111111',
      change_type: 'substitute',
      original_session_date: null,
      original_start_time: null,
      original_end_time: null,
      new_session_date: null,
      new_start_time: null,
      new_end_time: null,
      original_teacher_id: '22222222-2222-2222-2222-222222222222',
      original_teacher_name: '王老師',
      operation_source: 'single',
      reason: '老師請假',
      created_by_name: '教務主任',
      created_at: '2026-03-10T08:00:00.000Z',
      staff: {
        id: '33333333-3333-3333-3333-333333333333',
        display_name: '李老師',
      },
    });

    expect(result).toMatchObject({
      originalTeacherId: '22222222-2222-2222-2222-222222222222',
      originalTeacherName: '王老師',
      operationSource: 'single',
      substituteTeacherName: '李老師',
    });
  });

  it('normalizes single-relation rows returned as arrays', () => {
    expect(
      normalizeRelationRow([
        {
          display_name: '王老師',
        },
      ]),
    ).toEqual({
      display_name: '王老師',
    });

    const result = mapSessionChange({
      id: '11111111-1111-1111-1111-111111111111',
      change_type: 'substitute',
      original_session_date: null,
      original_start_time: null,
      original_end_time: null,
      new_session_date: null,
      new_start_time: null,
      new_end_time: null,
      original_teacher_id: '22222222-2222-2222-2222-222222222222',
      original_teacher_name: '王老師',
      operation_source: 'single',
      reason: '老師請假',
      created_by_name: '教務主任',
      created_at: '2026-03-10T08:00:00.000Z',
      staff: [
        {
          id: '33333333-3333-3333-3333-333333333333',
          display_name: '李老師',
        },
      ],
    });

    expect(result.substituteTeacherName).toBe('李老師');
  });
});

describe('single session history payloads', () => {
  it('records original teacher snapshot and single operation source for substitute', () => {
    const payload = buildSingleSessionChangeInsert({
      orgId: 'org-1',
      sessionId: 'session-1',
      changeType: 'substitute',
      sessionState: {
        assignmentStatus: 'assigned',
        status: 'scheduled',
        classId: 'class-1',
        sessionDate: '2026-03-10',
        startTime: '09:00:00',
        endTime: '11:00:00',
        teacherId: 'teacher-origin',
        teacherName: '原任老師',
      },
      createdByName: '教務主任',
      reason: '老師請假',
      substituteTeacherId: 'teacher-substitute',
    });

    expect(payload).toMatchObject({
      change_type: 'substitute',
      original_teacher_id: 'teacher-origin',
      original_teacher_name: '原任老師',
      substitute_teacher_id: 'teacher-substitute',
      operation_source: 'single',
    });
  });
});

describe('batch session history payloads', () => {
  it('marks batch cancellation and uncancel changes with batch operation source', () => {
    const changes = buildBatchSessionChangeInserts({
      orgId: 'org-1',
      createdByName: '教務主任',
      changeType: 'cancellation',
      sessionStates: [
        {
          assignmentStatus: 'assigned',
          status: 'scheduled',
          classId: 'class-1',
          sessionDate: '2026-03-11',
          startTime: '09:00:00',
          endTime: '11:00:00',
          teacherId: 'teacher-1',
          teacherName: '王老師',
          sessionId: 'session-1',
        },
      ],
      reason: '颱風停課',
    });

    expect(changes).toEqual([
      expect.objectContaining({
        session_id: 'session-1',
        change_type: 'cancellation',
        operation_source: 'batch',
      }),
    ]);

    const uncancelChanges = buildBatchSessionChangeInserts({
      orgId: 'org-1',
      createdByName: '教務主任',
      changeType: 'uncancel',
      sessionStates: [
        {
          assignmentStatus: 'assigned',
          status: 'cancelled',
          classId: 'class-1',
          sessionDate: '2026-03-11',
          startTime: '09:00:00',
          endTime: '11:00:00',
          teacherId: 'teacher-1',
          teacherName: '王老師',
          sessionId: 'session-2',
        },
      ],
    });

    expect(uncancelChanges).toEqual([
      expect.objectContaining({
        session_id: 'session-2',
        change_type: 'uncancel',
        operation_source: 'batch',
      }),
    ]);
  });

  it('marks batch update-time changes with batch operation source', () => {
    const changes = buildBatchSessionChangeInserts({
      orgId: 'org-1',
      createdByName: '教務主任',
      changeType: 'reschedule',
      sessionStates: [
        {
          assignmentStatus: 'assigned',
          status: 'scheduled',
          classId: 'class-1',
          sessionDate: '2026-03-12',
          startTime: '09:00:00',
          endTime: '11:00:00',
          teacherId: 'teacher-1',
          teacherName: '王老師',
          sessionId: 'session-3',
        },
      ],
      newStartTime: '10:00:00',
      newEndTime: '12:00:00',
    });

    expect(changes).toEqual([
      expect.objectContaining({
        session_id: 'session-3',
        change_type: 'reschedule',
        original_session_date: '2026-03-12',
        new_session_date: '2026-03-12',
        new_start_time: '10:00:00',
        new_end_time: '12:00:00',
        operation_source: 'batch',
      }),
    ]);
  });
});

/**
 * **補課連結的寫入不是原子的，而順序是設計的一部分。**
 *
 * PostgREST 走 HTTP，`.update()` 與 `.insert()` 是兩次獨立請求 —— 沒有跨語句
 * transaction，而這個 repo 刻意不引入 RPC（plpgsql 函式跑在 service role 底下，
 * 等於把授權邏輯搬到 middleware 之下，違反憲法 c1 的形狀。計畫席 2026-09-06 裁定）。
 *
 * 所以順序是「**先寫 FK、再寫流水、失敗補償**」，而選它的理由只有一個：
 *
 * > **兩個非原子的寫入，順序決定了失敗態能不能被發現。**
 *
 * 反過來（先流水後 FK）的失敗態是「流水有、FK 沒有」——**而那跟「有人設過後來
 * 解除了」這個合法狀態一模一樣**，沒有人分得出來。
 */
describe('PATCH /api/sessions/:id/makeup —— 非原子寫入的順序與補償', () => {
  const SESSION_ID = '00000000-0000-4000-8000-000000000001';
  const TARGET_ID = '00000000-0000-4000-8000-000000000002';

  interface Call {
    table: string;
    op: 'update' | 'insert';
    payload?: Record<string, unknown>;
    isCompensation?: boolean;
  }

  function createApp(options?: { logInsertFails?: boolean; compensateFails?: boolean }) {
    const calls: Call[] = [];
    let updateCount = 0;

    const supabase = {
      from(table: string) {
        const record: Call = { table, op: 'update' };
        const query: Record<string, unknown> = {
          select: () => query,
          eq: () => query,
          maybeSingle: () =>
            Promise.resolve({
              data:
                table === 'profiles'
                  ? { display_name: '王主任' }
                  : {
                      id: SESSION_ID,
                      class_id: 'class-1',
                      status: 'scheduled',
                      session_date: '2026-04-20',
                      makeup_for_session_id: null,
                    },
              error: null,
            }),
          single: () =>
            Promise.resolve({
              data: {
                id: TARGET_ID,
                class_id: 'class-1',
                status: 'cancelled',
                session_date: '2026-04-06',
              },
              error: null,
            }),
          // ⚠️ **`update()` / `insert()` 之後還會接 `.eq()`，所以它們要回 query
          // 不是 Promise。** 終點統一在 `then` —— 今天第三次踩同一個坑
          // （直接回 Promise 的話路由當場拋例外，而那個例外變成 Hono 的
          //  `Internal Server Error`，跟路由自己回的 500 在狀態碼上一模一樣）。
          update: (payload: Record<string, unknown>) => {
            record.op = 'update';
            record.payload = payload;
            calls.push(record);
            updateCount += 1;
            record.isCompensation = updateCount === 2;
            return query;
          },
          insert: (payload: Record<string, unknown>) => {
            record.op = 'insert';
            record.payload = payload;
            calls.push(record);
            return Promise.resolve({
              error: options?.logInsertFails ? { message: '流水寫不進去' } : null,
            });
          },
          then: (onfulfilled?: ((value: unknown) => unknown) | null) => {
            const failed = record.isCompensation && options?.compensateFails;
            return Promise.resolve({
              error: failed ? { message: '補償也失敗' } : null,
            }).then(onfulfilled ?? undefined);
          },
        };
        return query;
      },
    };

    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      const ctx = c as unknown as { set: (k: string, v: unknown) => void };
      ctx.set('supabase', supabase);
      ctx.set('orgId', 'org-1');
      ctx.set('userId', 'user-1');
      ctx.set('roles', ['admin']);
      ctx.set('campusScope', null);
      await next();
    });
    app.route('/api/sessions', sessionsApp);

    async function patch(body: unknown) {
      return app.request(
        `/api/sessions/${SESSION_ID}/makeup`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        undefined,
        { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
      );
    }

    return { patch, calls };
  }

  it('⚠️ 順序是先 FK 再流水 —— 反過來的失敗態跟一個合法狀態長得一樣', async () => {
    const { patch, calls } = createApp();
    const res = await patch({ makeupForSessionId: TARGET_ID });

    expect(res.status).toBe(200);
    const writes = calls.filter((c) => c.table === 'sessions' || c.table === 'schedule_changes');
    expect(writes[0]).toMatchObject({ table: 'sessions', op: 'update' });
    expect(writes[1]).toMatchObject({ table: 'schedule_changes', op: 'insert' });
  });

  it('⚠️ 流水寫失敗 → 把 FK 補償回去，不留「FK 有、流水沒有」', async () => {
    const { patch, calls } = createApp({ logInsertFails: true });
    const res = await patch({ makeupForSessionId: TARGET_ID });

    expect(res.status).toBe(500);
    const updates = calls.filter((c) => c.table === 'sessions' && c.op === 'update');
    expect(updates).toHaveLength(2);
    // 補償把它清回 null —— 不是清成別的值
    expect(updates[1]?.payload).toEqual({ makeup_for_session_id: null });
  });

  it('補償也失敗 → 仍然回 500，而且不假裝成功', async () => {
    // 這時才落到那個可查的失敗態（FK 有、流水沒有）。**回 200 會讓它消失在雷達外**
    const { patch } = createApp({ logInsertFails: true, compensateFails: true });
    expect((await patch({ makeupForSessionId: TARGET_ID })).status).toBe(500);
  });

  it('清除連結（傳 null）不寫流水 —— 連結解除本來就該只留舊的那筆', async () => {
    const { patch, calls } = createApp();
    const res = await patch({ makeupForSessionId: null });

    expect(res.status).toBe(200);
    expect(calls.filter((c) => c.table === 'schedule_changes')).toHaveLength(0);
    expect(calls.find((c) => c.table === 'sessions')?.payload).toEqual({
      makeup_for_session_id: null,
    });
  });
});

describe('mapSessionMakeup（#499 讀取面的兩個方向）', () => {
  it('正向：這堂補的是哪一堂 —— PostgREST 回物件', () => {
    const result = mapSessionMakeup({
      makeup_for: { id: 's-cancelled', session_date: '2026-04-01', status: 'cancelled' },
      made_up_by: [],
    });

    expect(result.makeupFor).toEqual({
      id: 's-cancelled',
      sessionDate: '2026-04-01',
      status: 'cancelled',
    });
    expect(result.madeUpBy).toBeNull();
  });

  it('反向：這堂停課被誰補了 —— PostgREST 回陣列', () => {
    const result = mapSessionMakeup({
      makeup_for: null,
      made_up_by: [{ id: 's-makeup', session_date: '2026-04-08', status: 'scheduled' }],
    });

    expect(result.madeUpBy).toEqual({
      id: 's-makeup',
      sessionDate: '2026-04-08',
      status: 'scheduled',
    });
  });

  // 反向的陣列**含停掉的補課** —— 排除條件必須跟部分唯一索引的述詞逐字一致
  // （`WHERE makeup_for_session_id IS NOT NULL AND status <> 'cancelled'`），
  // 不一致的話「有幾堂補課」與「有幾堂**有效的**補課」會給出不同答案。
  it('反向：停掉的補課不算 —— 補了又停掉等於沒補', () => {
    const result = mapSessionMakeup({
      makeup_for: null,
      made_up_by: [{ id: 's-dead', session_date: '2026-04-08', status: 'cancelled' }],
    });

    expect(result.madeUpBy).toBeNull();
  });

  it('反向：停掉的與有效的並存時，只回有效的那一堂', () => {
    const result = mapSessionMakeup({
      makeup_for: null,
      made_up_by: [
        { id: 's-dead', session_date: '2026-04-08', status: 'cancelled' },
        { id: 's-live', session_date: '2026-04-15', status: 'scheduled' },
      ],
    });

    expect(result.madeUpBy?.id).toBe('s-live');
  });

  it('兩個方向都沒有時回 null，不回 undefined', () => {
    const result = mapSessionMakeup({});

    expect(result.makeupFor).toBeNull();
    expect(result.madeUpBy).toBeNull();
  });
});

describe('sessionListSelect —— 補課的兩個 embed 不能有 !inner', () => {
  // 本機 PostgREST 實測：任一方向加上 `!inner`，19 筆變 **0 筆** ——
  // 它會把「沒有補課連結的課堂」整批篩掉，也就是幾乎所有課堂。
  //
  // 症狀是**課表突然空了**，而那離原因很遠（沒有人會想到是一個 embed 的修飾字）。
  //
  // ⚠️ 這支測試存在的理由是：`classes!inner` / `courses!inner` 就在上面幾行，
  // 兩個補課 embed 沒有 `!inner` **看起來像漏寫的不對稱**，而「補齊它」
  // 是一個看起來像改進的動作。改壞的時候要有東西紅。
  it('正向不能有 !inner', () => {
    expect(sessionListSelect(false)).not.toContain('makeup_for_session_id!inner');
    expect(sessionListSelect(true)).not.toContain('makeup_for_session_id!inner');
  });

  it('反向不能有 !inner', () => {
    expect(sessionListSelect(false)).not.toContain('sessions!makeup_for_session_id!inner');
    expect(sessionListSelect(true)).not.toContain('sessions!makeup_for_session_id!inner');
  });

  it('兩個方向都還在（不能為了避開 !inner 而整個拿掉）', () => {
    const select = sessionListSelect(false);

    expect(select).toContain('makeup_for:makeup_for_session_id');
    expect(select).toContain('made_up_by:sessions!makeup_for_session_id');
  });

  // `events` 的修飾字是**有條件的** —— 跟補課那兩個不同，它該不該有 `!inner`
  // 取決於是不是要用 `attendance_taken_at` 篩父列。釘住這個差異，
  // 免得有人「統一」成同一種寫法。
  it('events 的 !inner 是有條件的，不要跟補課那兩個一起「統一」', () => {
    // 實際字串是 `events!event_id!inner`（hint + inner），不是 `events!inner` ——
    // 這裡刻意用完整的字串斷言，因為半截的 pattern 會在兩種寫法上都命中。
    expect(sessionListSelect(true)).toContain('events!event_id!inner');
    expect(sessionListSelect(false)).toContain('events!event_id ');
    expect(sessionListSelect(false)).not.toContain('!inner ( attendance_taken_at )');
  });
});
