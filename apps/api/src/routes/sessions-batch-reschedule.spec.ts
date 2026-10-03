import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import sessionsApp, { resolveRescheduleDate } from './sessions';

/**
 * `PATCH /api/sessions/batch-reschedule`（#1111）。
 *
 * 替身記下每支查詢的條件，回傳依表名＋條件決定。替身不實作 `eq`／`in`：
 * 「新日期上的既有課」由 fixture 直接給，分校靠 fixture 的 campus_id 對 campusScope。
 */
interface Op {
  readonly name: string;
  readonly args: readonly unknown[];
}
interface RecordedQuery {
  readonly table: string;
  readonly ops: Op[];
}

const has = (q: RecordedQuery, name: string, ...args: unknown[]) =>
  q.ops.some(
    (op) =>
      op.name === name && args.every((a, i) => JSON.stringify(op.args[i]) === JSON.stringify(a)),
  );
const arg = (q: RecordedQuery, name: string, i = 0) =>
  q.ops.find((op) => op.name === name)?.args[i];

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

// 2026-10-21 是週三
const session = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n),
  class_id: 'class-1',
  session_date: '2026-10-21',
  start_time: '09:00:00',
  end_time: '11:00:00',
  status: 'scheduled',
  teacher_id: 'teacher-1',
  classes: { campus_id: 'campus-1' },
  ...over,
});

interface Fixture {
  sessions?: unknown[];
  classPeers?: unknown[];
  teacherPeers?: unknown[];
  updateErrorAt?: number;
  updateError?: unknown;
  logError?: unknown;
}

function createApp(f: Fixture = {}, campusScope: string[] | null = null) {
  const queries: RecordedQuery[] = [];
  let updates = 0;
  const resolve = (q: RecordedQuery) => {
    if (q.table === 'sessions') {
      if (has(q, 'update')) {
        updates += 1;
        return updates === f.updateErrorAt ? { error: f.updateError } : {};
      }
      if (has(q, 'in', 'id')) return { data: f.sessions ?? [session(1)] };
      if (q.ops.some((op) => op.name === 'in' && op.args[0] === 'teacher_id')) {
        return { data: f.teacherPeers ?? [] };
      }
      return { data: f.classPeers ?? [] };
    }
    if (q.table === 'schedule_changes') return f.logError ? { error: f.logError } : {};
    if (q.table === 'profiles') return { data: { display_name: '行政 A' } };
    return { data: [] };
  };
  const supabase = {
    from(table: string) {
      const recorded: RecordedQuery = { table, ops: [] };
      queries.push(recorded);
      const query: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === 'then') {
              return (onfulfilled?: (value: unknown) => unknown) =>
                Promise.resolve({ data: null, error: null, ...resolve(recorded) }).then(
                  onfulfilled,
                );
            }
            return (...args: unknown[]) => {
              recorded.ops.push({ name: prop, args });
              return query;
            };
          },
        },
      );
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
    ctx.set('campusScope', campusScope);
    await next();
  });
  app.route('/api/sessions', sessionsApp);
  return { app, queries };
}

const patch = (app: Hono, b: unknown) =>
  app.request('/api/sessions/batch-reschedule', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  });
const sessionUpdates = (queries: RecordedQuery[]) =>
  queries.filter((q) => q.table === 'sessions' && has(q, 'update'));
const writes = (queries: RecordedQuery[]) =>
  queries.filter((q) => q.table !== 'audit_logs' && (has(q, 'update') || has(q, 'insert')));

interface Result {
  updated: number;
  skipped: number;
  processableIds: string[];
  conflicts: Array<{ sessionId: string; reason: string; conflictingSessionId?: string }>;
  planned: Array<{
    sessionId: string;
    newSessionDate: string;
    newStartTime: string;
    newEndTime: string;
  }>;
  dryRun: boolean;
}

describe('resolveRescheduleDate（#1111）', () => {
  it.each([
    ['週三 → 週五（同週往後）', '2026-10-21', { targetWeekday: 5 }, '2026-10-23'],
    ['週三 → 週一（同週往前，不是下週）', '2026-10-21', { targetWeekday: 1 }, '2026-10-19'],
    ['週日 → 週一（週日是週末那天，往前 6 天）', '2026-10-25', { targetWeekday: 1 }, '2026-10-19'],
    ['跨月', '2026-10-30', { targetWeekday: 7 }, '2026-11-01'],
    ['dayOffset 往前跨月', '2026-11-02', { dayOffset: -7 }, '2026-10-26'],
  ])('%s', (_name, date, target, expected) => {
    expect(resolveRescheduleDate(date, target)).toBe(expected);
  });
});

describe('PATCH /api/sessions/batch-reschedule（#1111）', () => {
  it.each([
    ['兩個都沒帶', {}, 'INVALID_TARGET'],
    ['兩個都帶', { dayOffset: 2, targetWeekday: 5 }, 'INVALID_TARGET'],
    ['dayOffset 0', { dayOffset: 0 }, 'INVALID_TARGET'],
    ['時段只帶一半', { dayOffset: 2, startTime: '10:00' }, 'INVALID_TIME_RANGE'],
    ['時段反了', { dayOffset: 2, startTime: '12:00', endTime: '10:00' }, 'INVALID_TIME_RANGE'],
  ])('body 不合法（%s）→ 400 %s，不查不寫', async (_n, extra, code) => {
    const { app, queries } = createApp();
    const res = await patch(app, { sessionIds: [id(1)], ...extra });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe(code);
    expect(queries).toHaveLength(0);
  });

  it.each([true, false])('有一堂別校 → 整批 403（dryRun=%s）', async (dryRun) => {
    const { app, queries } = createApp(
      { sessions: [session(1), session(2, { classes: { campus_id: 'campus-2' } })] },
      ['campus-1'],
    );
    const res = await patch(app, { sessionIds: [id(1), id(2)], targetWeekday: 5, dryRun });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
    expect(writes(queries)).toHaveLength(0);
  });

  it('不帶 dryRun 只預覽：planned 列每堂落點，逐堂不符列在 conflicts', async () => {
    const { app, queries } = createApp({
      sessions: [
        session(1),
        session(2, { status: 'cancelled' }),
        session(3, { session_date: '2026-10-23' }), // 本來就在週五 → no_change
        session(4, { class_id: 'class-2', teacher_id: 'teacher-2' }),
        session(5, { class_id: 'class-3', teacher_id: 'teacher-3' }),
      ],
      classPeers: [
        {
          id: 'peer-c',
          class_id: 'class-2',
          session_date: '2026-10-23',
          start_time: '10:00:00',
          end_time: '12:00:00',
        },
        // 同批要搬走的堂不擋位
        {
          id: id(1),
          class_id: 'class-1',
          session_date: '2026-10-23',
          start_time: '09:00:00',
          end_time: '11:00:00',
        },
      ],
      teacherPeers: [
        {
          id: 'peer-t',
          teacher_id: 'teacher-3',
          session_date: '2026-10-23',
          start_time: '08:00:00',
          end_time: '09:30:00',
        },
      ],
    });
    const res = await patch(app, { sessionIds: [1, 2, 3, 4, 5].map(id), targetWeekday: 5 });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Result;
    expect(json).toMatchObject({ updated: 0, skipped: 4, processableIds: [id(1)], dryRun: true });
    expect(json.planned).toEqual([
      {
        sessionId: id(1),
        newSessionDate: '2026-10-23',
        newStartTime: '09:00',
        newEndTime: '11:00',
      },
    ]);
    expect(json.conflicts.map((c) => [c.sessionId, c.reason, c.conflictingSessionId])).toEqual([
      [id(3), 'no_change', undefined],
      [id(2), 'status_not_editable', undefined],
      [id(4), 'class_conflict', 'peer-c'],
      [id(5), 'teacher_conflict', 'peer-t'],
    ]);
    expect(writes(queries)).toHaveLength(0);
  });

  it('落點上的課是同一批要搬走的另一堂 → 不擋（整期往後挪）', async () => {
    const { app } = createApp({
      sessions: [session(1), session(6, { session_date: '2026-10-23' })],
      // 10/21 那堂要搬到 10/23，而 10/23 那堂自己也要搬到 10/25
      classPeers: [
        {
          id: id(6),
          class_id: 'class-1',
          session_date: '2026-10-23',
          start_time: '09:00:00',
          end_time: '11:00:00',
        },
      ],
      teacherPeers: [
        {
          id: id(6),
          teacher_id: 'teacher-1',
          session_date: '2026-10-23',
          start_time: '09:00:00',
          end_time: '11:00:00',
        },
      ],
    });
    const res = await patch(app, { sessionIds: [id(1), id(6)], dayOffset: 2 });
    const json = (await res.json()) as Result;
    expect(json.conflicts).toEqual([]);
    expect(json.processableIds).toEqual([id(1), id(6)]);
  });

  it('同一批落到同一班同時段 → 第二堂 class_conflict', async () => {
    const { app } = createApp({
      sessions: [session(1), session(2, { session_date: '2026-10-22' })],
    });
    const res = await patch(app, {
      sessionIds: [id(1), id(2)],
      targetWeekday: 5,
      startTime: '14:00',
      endTime: '16:00',
    });
    const json = (await res.json()) as Result;
    expect(json.processableIds).toEqual([id(1)]);
    expect(json.conflicts.map((c) => [c.sessionId, c.reason])).toEqual([[id(2), 'class_conflict']]);
  });

  it('dryRun=false：照新落點分組 update、逐堂寫 reschedule 流水', async () => {
    const { app, queries } = createApp({
      sessions: [
        session(1),
        session(2, { class_id: 'class-2', teacher_id: 'teacher-2' }),
        session(3, { session_date: '2026-10-28', class_id: 'class-3' }),
      ],
    });
    const res = await patch(app, {
      sessionIds: [1, 2, 3].map(id),
      dayOffset: 2,
      reason: '段考週',
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Result).updated).toBe(3);

    expect(sessionUpdates(queries).map((q) => [arg(q, 'update'), arg(q, 'in', 1)])).toEqual([
      // 往後挪：落點由晚到早（先把後面的位置空出來，見 handler 的註解）
      [{ session_date: '2026-10-30', start_time: '09:00', end_time: '11:00' }, [id(3)]],
      [{ session_date: '2026-10-23', start_time: '09:00', end_time: '11:00' }, [id(1), id(2)]],
    ]);
    expect(sessionUpdates(queries).every((q) => has(q, 'eq', 'org_id', 'org-1'))).toBe(true);

    const [insert] = queries.filter((q) => q.table === 'schedule_changes' && has(q, 'insert'));
    expect(arg(insert, 'insert')).toContainEqual(
      expect.objectContaining({
        session_id: id(3),
        change_type: 'reschedule',
        original_session_date: '2026-10-28',
        original_start_time: '09:00:00',
        new_session_date: '2026-10-30',
        new_start_time: '09:00',
        reason: '段考週',
        created_by_name: '行政 A',
        operation_source: 'batch',
      }),
    );
  });

  it('流水寫失敗 → 全部照原落點搬回，500 RESCHEDULE_LOG_FAILED', async () => {
    const { app, queries } = createApp({
      sessions: [session(1), session(2, { session_date: '2026-10-28' })],
      logError: { message: 'boom' },
    });
    const res = await patch(app, { sessionIds: [id(1), id(2)], dayOffset: 1, dryRun: false });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe('RESCHEDULE_LOG_FAILED');
    const reverts = sessionUpdates(queries)
      .slice(2)
      .map((q) => [arg(q, 'update'), arg(q, 'in', 1)]);
    expect(reverts).toEqual([
      [{ session_date: '2026-10-21', start_time: '09:00', end_time: '11:00' }, [id(1)]],
      [{ session_date: '2026-10-28', start_time: '09:00', end_time: '11:00' }, [id(2)]],
    ]);
  });

  it('update 中途撞唯一鍵 → 只把已搬的搬回，409 CLASS_CONFLICT，不寫流水', async () => {
    const { app, queries } = createApp({
      sessions: [session(1), session(2, { session_date: '2026-10-28' })],
      updateErrorAt: 2,
      updateError: { code: '23505', message: 'dup' },
    });
    const res = await patch(app, { sessionIds: [id(1), id(2)], dayOffset: 1, dryRun: false });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('CLASS_CONFLICT');
    const updates = sessionUpdates(queries).map((q) => [arg(q, 'update'), arg(q, 'in', 1)]);
    // 由晚到早：先搬 id(2)（落點 10/29）成功，再搬 id(1) 撞鍵 → 只把 id(2) 搬回 10/28
    expect(updates[2]).toEqual([
      { session_date: '2026-10-28', start_time: '09:00', end_time: '11:00' },
      [id(2)],
    ]);
    expect(updates).toHaveLength(3);
    expect(queries.filter((q) => q.table === 'schedule_changes')).toHaveLength(0);
  });

  // 二讀抓到的：唯一鍵 (class_id, session_date, start_time) 在逐組 UPDATE 時會被「還沒搬走的下一堂」擋住。
  // 這個替身**真的檢查唯一鍵**：每組 update 套到一份記憶體裡的課表，撞號就回 23505
  describe('唯一鍵 (class_id, session_date, start_time)（二讀）', () => {
    const chain = () => [
      session(1, { session_date: '2026-10-21' }),
      session(2, { session_date: '2026-10-22' }),
      session(3, { session_date: '2026-10-23' }),
    ];

    it.each([
      ['整期往後挪一天', 1, ['2026-10-22', '2026-10-23', '2026-10-24']],
      ['整期往前挪一天', -1, ['2026-10-20', '2026-10-21', '2026-10-22']],
    ] as const)('%s：一鏈三堂同班同時段，照順序搬不會互撞', async (_n, dayOffset, expected) => {
      const rows = chain();
      const table = rows.map((r) => ({ ...r }));
      const order: string[][] = [];
      const { app, queries } = createApp({ sessions: rows });
      const res = await patch(app, { sessionIds: [1, 2, 3].map(id), dayOffset, dryRun: false });
      expect(res.status).toBe(200);
      // 依實際發出的順序套到課表上，每一步都不能撞唯一鍵
      for (const q of sessionUpdates(queries)) {
        const p = arg(q, 'update') as Record<string, string>;
        const ids = arg(q, 'in', 1) as string[];
        order.push(ids);
        for (const row of table.filter((r) => ids.includes(r['id'] as string))) {
          row['session_date'] = p['session_date'];
        }
        const keys = table.map((r) => `${r['class_id']}|${r['session_date']}|${r['start_time']}`);
        expect(new Set(keys).size).toBe(keys.length);
      }
      expect(table.map((r) => r['session_date'])).toEqual(expected);
      expect(order).toEqual(
        dayOffset > 0 ? [[id(3)], [id(2)], [id(1)]] : [[id(1)], [id(2)], [id(3)]],
      );
    });

    it('留在原地的 no_change 也擋位（不會有別堂被允許搬到它頭上）', async () => {
      const { app, queries } = createApp({
        sessions: [
          session(1, { session_date: '2026-10-21' }), // 週三 → 週五
          session(2, { session_date: '2026-10-23' }), // 本來就在週五：no_change，留在原地
        ],
        classPeers: [
          {
            id: id(2),
            class_id: 'class-1',
            session_date: '2026-10-23',
            start_time: '10:00:00',
            end_time: '12:00:00',
          },
        ],
      });
      const res = await patch(app, { sessionIds: [id(1), id(2)], targetWeekday: 5 });
      const json = (await res.json()) as Result;
      expect(json.conflicts.map((c) => [c.sessionId, c.reason])).toEqual([
        [id(2), 'no_change'],
        [id(1), 'class_conflict'],
      ]);
      expect(sessionUpdates(queries)).toHaveLength(0);
    });
  });
});
