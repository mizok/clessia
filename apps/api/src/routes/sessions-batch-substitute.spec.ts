import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import sessionsApp from './sessions';

/**
 * `PATCH /api/sessions/batch-substitute`（#1110）與 batch-assign-teacher 的分校檢查。
 *
 * 替身記下每支查詢的條件，回傳依表名＋條件決定。替身不實作 `eq`／`in`，
 * 分校範圍靠 fixture 的 campus_id 對 campusScope；真的過濾要本機實打。
 */
interface Op {
  readonly name: string;
  readonly args: readonly unknown[];
}
interface RecordedQuery {
  readonly table: string;
  readonly ops: Op[];
}
type Resolver = (q: RecordedQuery) => { data?: unknown; error?: unknown } | undefined;

const has = (q: RecordedQuery, name: string, ...args: unknown[]) =>
  q.ops.some(
    (op) =>
      op.name === name && args.every((a, i) => JSON.stringify(op.args[i]) === JSON.stringify(a)),
  );
const arg = (q: RecordedQuery, name: string, i = 0) =>
  q.ops.find((op) => op.name === name)?.args[i];

function createApp(resolve: Resolver, campusScope: string[] | null = null) {
  const queries: RecordedQuery[] = [];
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

const SUB = '99999999-9999-4999-8999-999999999999';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const session = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n),
  class_id: 'class-1',
  session_date: '2026-10-20',
  start_time: `${String(8 + n * 2).padStart(2, '0')}:00:00`,
  end_time: `${String(9 + n * 2).padStart(2, '0')}:00:00`,
  status: 'scheduled',
  teacher_id: T1,
  ...over,
});

interface Fixture {
  sessions?: unknown[];
  classCampus?: string;
  teacher?: Record<string, unknown> | null;
  busy?: unknown[];
  subjects?: string[];
  logError?: unknown;
}

function resolver(f: Fixture = {}): Resolver {
  return (q) => {
    if (q.table === 'sessions') {
      if (has(q, 'update')) return {};
      if (has(q, 'eq', 'teacher_id', SUB)) return { data: f.busy ?? [] };
      return { data: f.sessions ?? [session(1)] };
    }
    if (q.table === 'classes') {
      return {
        data: [
          {
            id: 'class-1',
            campus_id: f.classCampus ?? 'campus-1',
            course_id: 'course-1',
            courses: { subject_id: 'math' },
          },
        ],
      };
    }
    if (q.table === 'courses') return { data: [{ id: 'course-1', subject_id: 'math' }] };
    if (q.table === 'staff') {
      if (has(q, 'maybeSingle')) {
        return {
          data:
            f.teacher === undefined ? { id: SUB, user_id: 'u-sub', status: 'active' } : f.teacher,
        };
      }
      return {
        data: [
          { id: T1, display_name: '王老師' },
          { id: T2, display_name: '李老師' },
        ],
      };
    }
    if (q.table === 'user_roles') return { data: { role: 'teacher' } };
    if (q.table === 'staff_subjects') {
      return { data: (f.subjects ?? ['math']).map((subject_id) => ({ subject_id })) };
    }
    if (q.table === 'staff_campuses') return { data: [{ campus_id: 'campus-1' }] };
    if (q.table === 'profiles') return { data: { display_name: '行政 A' } };
    if (q.table === 'schedule_changes') return f.logError ? { error: f.logError } : {};
    return { data: [] };
  };
}

const patch = (app: Hono, path: string, b: unknown) =>
  app.request(`/api/sessions/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  });
const writes = (queries: RecordedQuery[]) =>
  queries.filter((q) => q.table !== 'audit_logs' && (has(q, 'update') || has(q, 'insert')));

describe('PATCH /api/sessions/batch-substitute（#1110）', () => {
  it.each([true, false])('有一堂別校 → 整批 403（dryRun=%s），不寫入', async (dryRun) => {
    const { app, queries } = createApp(resolver({ classCampus: 'campus-2' }), ['campus-1']);
    const res = await patch(app, 'batch-substitute', {
      sessionIds: [id(1)],
      substituteTeacherId: SUB,
      dryRun,
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
    expect(writes(queries)).toHaveLength(0);
  });

  it('代課老師不是本 org 在職老師 → 整批 409 TEACHER_NOT_ELIGIBLE', async () => {
    const { app, queries } = createApp(resolver({ teacher: null }));
    const res = await patch(app, 'batch-substitute', {
      sessionIds: [id(1)],
      substituteTeacherId: SUB,
      dryRun: false,
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('TEACHER_NOT_ELIGIBLE');
    expect(writes(queries)).toHaveLength(0);
  });

  it('逐堂不符的列在 conflicts；不帶 dryRun 就只預覽', async () => {
    const { app, queries } = createApp(
      resolver({
        sessions: [
          session(1),
          session(2, { status: 'cancelled' }),
          session(3, { teacher_id: null }),
          session(4, { teacher_id: SUB }),
          session(5),
        ],
        // 第 5 堂（18:00–19:00）跟代課老師既有的課重疊
        busy: [
          {
            id: 'busy-1',
            session_date: '2026-10-20',
            start_time: '18:30:00',
            end_time: '19:30:00',
          },
        ],
      }),
    );
    const res = await patch(app, 'batch-substitute', {
      sessionIds: [1, 2, 3, 4, 5].map(id),
      substituteTeacherId: SUB,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      updated: number;
      skipped: number;
      processableIds: string[];
      conflicts: Array<{ sessionId: string; reason: string; conflictingSessionId?: string }>;
      dryRun: boolean;
    };
    expect(json).toMatchObject({ updated: 0, skipped: 4, processableIds: [id(1)], dryRun: true });
    expect(json.conflicts.map((c) => [c.sessionId, c.reason])).toEqual([
      [id(2), 'status_not_editable'],
      [id(3), 'unassigned'],
      [id(4), 'same_teacher'],
      [id(5), 'teacher_conflict'],
    ]);
    expect(json.conflicts[3].conflictingSessionId).toBe('busy-1');
    expect(writes(queries)).toHaveLength(0);
  });

  it('科目不符 → teacher_not_eligible', async () => {
    const { app } = createApp(resolver({ subjects: ['english'] }));
    const res = await patch(app, 'batch-substitute', {
      sessionIds: [id(1)],
      substituteTeacherId: SUB,
    });
    const json = (await res.json()) as { conflicts: Array<{ reason: string }> };
    expect(json.conflicts.map((c) => c.reason)).toEqual(['teacher_not_eligible']);
  });

  it('dryRun=false：改老師＋逐堂寫 substitute 流水（原老師、batch）', async () => {
    const { app, queries } = createApp(
      resolver({ sessions: [session(1), session(2, { teacher_id: T2 })] }),
    );
    const res = await patch(app, 'batch-substitute', {
      sessionIds: [id(1), id(2)],
      substituteTeacherId: SUB,
      reason: '王老師請假',
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(2);

    const [update] = queries.filter((q) => q.table === 'sessions' && has(q, 'update'));
    expect(arg(update, 'update')).toEqual({ teacher_id: SUB, assignment_status: 'assigned' });
    expect(has(update, 'in', 'id', [id(1), id(2)])).toBe(true);
    expect(has(update, 'eq', 'org_id', 'org-1')).toBe(true);

    const [insert] = queries.filter((q) => q.table === 'schedule_changes' && has(q, 'insert'));
    expect(arg(insert, 'insert')).toEqual([
      expect.objectContaining({
        session_id: id(1),
        change_type: 'substitute',
        original_teacher_id: T1,
        original_teacher_name: '王老師',
        substitute_teacher_id: SUB,
        reason: '王老師請假',
        operation_source: 'batch',
      }),
      expect.objectContaining({
        session_id: id(2),
        original_teacher_id: T2,
        original_teacher_name: '李老師',
      }),
    ]);
  });

  it('流水寫失敗 → 照原老師分組改回去，回 500', async () => {
    const { app, queries } = createApp(
      resolver({
        sessions: [session(1), session(2, { teacher_id: T2 }), session(3)],
        logError: { message: 'boom' },
      }),
    );
    const res = await patch(app, 'batch-substitute', {
      sessionIds: [1, 2, 3].map(id),
      substituteTeacherId: SUB,
      dryRun: false,
    });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe('SUBSTITUTE_LOG_FAILED');

    const reverts = queries
      .filter((q) => q.table === 'sessions' && has(q, 'update'))
      .slice(1)
      .map((q) => [arg(q, 'update'), arg(q, 'in', 1)]);
    expect(reverts).toEqual([
      [{ teacher_id: T1 }, [id(1), id(3)]],
      [{ teacher_id: T2 }, [id(2)]],
    ]);
  });
});

describe('PATCH /api/sessions/batch-assign-teacher —— 分校檢查（#1110）', () => {
  it('有一堂別校 → 整批 403，不寫入', async () => {
    const { app, queries } = createApp(resolver({ classCampus: 'campus-2' }), ['campus-1']);
    const res = await patch(app, 'batch-assign-teacher', {
      sessionIds: [id(1)],
      teacherId: SUB,
      includeAssigned: true,
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
    expect(writes(queries)).toHaveLength(0);
  });

  it('不受限的管理員照常指派', async () => {
    const { app, queries } = createApp(resolver({ classCampus: 'campus-2' }), null);
    const res = await patch(app, 'batch-assign-teacher', {
      sessionIds: [id(1)],
      teacherId: SUB,
      includeAssigned: true,
    });
    expect(res.status).toBe(200);
    expect(writes(queries)).toHaveLength(0); // campus-2 不在老師的分校 → 不符資格，但不是 403
    expect(((await res.json()) as { skippedNotEligible: number }).skippedNotEligible).toBe(1);
  });

  it('受限管理員、同校 → 照常指派', async () => {
    const { app, queries } = createApp(resolver(), ['campus-1']);
    const res = await patch(app, 'batch-assign-teacher', {
      sessionIds: [id(1)],
      teacherId: SUB,
      includeAssigned: true,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(1);
    expect(writes(queries)).toHaveLength(1);
  });
});
