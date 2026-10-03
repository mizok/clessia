import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import sessionsApp from './sessions';

/**
 * `POST /api/sessions` 加開單堂（#1109）與歷程不重複合成 creation。
 *
 * 替身記下每支查詢的條件（`ops`），回傳由 `resolve` 依表名＋條件決定。
 * 替身不實作 `eq`／`in` —— 分校範圍只能靠 fixture 的 campus_id 對 campusScope。
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
const arg = (q: RecordedQuery, name: string) => q.ops.find((op) => op.name === name)?.args[0];

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

const CLASS_ID = '11111111-1111-4111-8111-111111111111';
const TEACHER_ID = '22222222-2222-4222-8222-222222222222';
const NEW_ID = '33333333-3333-4333-8333-333333333333';

const createdRow = {
  id: NEW_ID,
  session_date: '2026-10-20',
  start_time: '19:00:00',
  end_time: '21:00:00',
  status: 'scheduled',
  class_id: CLASS_ID,
  teacher_id: TEACHER_ID,
  assignment_status: 'assigned',
  event_id: null,
  classes: {
    name: '數學 A',
    courses: { id: 'course-1', name: '數學' },
    campuses: { id: 'campus-1', name: '總校' },
  },
  staff: { display_name: '王老師' },
  events: null,
  makeup_for: null,
  made_up_by: [],
};

interface Overrides {
  classRow?: Record<string, unknown> | null;
  staffRow?: Record<string, unknown> | null;
  classPeers?: unknown[];
  teacherPeers?: unknown[];
  insertError?: unknown;
  logError?: unknown;
}

function resolver(o: Overrides = {}): Resolver {
  return (q) => {
    if (q.table === 'classes') {
      return {
        data:
          o.classRow === undefined
            ? { id: CLASS_ID, campus_id: 'campus-1', is_active: true }
            : o.classRow,
      };
    }
    if (q.table === 'staff')
      return { data: o.staffRow === undefined ? { id: TEACHER_ID } : o.staffRow };
    if (q.table === 'sessions') {
      if (has(q, 'insert')) {
        return o.insertError ? { data: null, error: o.insertError } : { data: { id: NEW_ID } };
      }
      if (has(q, 'delete')) return {};
      if (has(q, 'eq', 'id', NEW_ID)) return { data: createdRow };
      if (has(q, 'eq', 'class_id', CLASS_ID)) return { data: o.classPeers ?? [] };
      if (has(q, 'eq', 'teacher_id', TEACHER_ID)) return { data: o.teacherPeers ?? [] };
    }
    if (q.table === 'schedule_changes' && has(q, 'insert')) {
      return o.logError ? { error: o.logError } : {};
    }
    if (q.table === 'profiles') return { data: { display_name: '行政 A' } };
    return { data: [] };
  };
}

const body = {
  classId: CLASS_ID,
  sessionDate: '2026-10-20',
  startTime: '19:00',
  endTime: '21:00',
  teacherId: TEACHER_ID,
  reason: '段考加強',
};

const post = (app: Hono, b: unknown) =>
  app.request('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  });

const inserts = (queries: RecordedQuery[], table: string) =>
  queries.filter((q) => q.table === table && has(q, 'insert'));

describe('POST /api/sessions —— 加開單堂（#1109）', () => {
  it('建 session（schedule_id null）＋寫一筆 creation 流水，回列表形狀', async () => {
    const { app, queries } = createApp(resolver());
    const res = await post(app, body);
    expect(res.status).toBe(201);

    const [sessionInsert] = inserts(queries, 'sessions');
    expect(arg(sessionInsert, 'insert')).toMatchObject({
      org_id: 'org-1',
      class_id: CLASS_ID,
      schedule_id: null,
      session_date: '2026-10-20',
      start_time: '19:00',
      end_time: '21:00',
      teacher_id: TEACHER_ID,
      assignment_status: 'assigned',
      status: 'scheduled',
      created_by: 'user-1',
    });

    const [logInsert] = inserts(queries, 'schedule_changes');
    expect(arg(logInsert, 'insert')).toMatchObject({
      org_id: 'org-1',
      session_id: NEW_ID,
      change_type: 'creation',
      new_session_date: '2026-10-20',
      reason: '段考加強',
      created_by_name: '行政 A',
      operation_source: 'single',
    });

    const json = (await res.json()) as {
      data: {
        id: string;
        teacherName: string;
        hasChanges: boolean;
        latestChange: { type: string };
      };
    };
    expect(json.data).toMatchObject({ id: NEW_ID, teacherName: '王老師', hasChanges: true });
    expect(json.data.latestChange.type).toBe('creation');
  });

  it('不帶老師 → unassigned，不查老師衝突', async () => {
    const { app, queries } = createApp(resolver());
    const res = await post(app, { ...body, teacherId: undefined });
    expect(res.status).toBe(201);
    expect(arg(inserts(queries, 'sessions')[0], 'insert')).toMatchObject({
      teacher_id: null,
      assignment_status: 'unassigned',
    });
    expect(
      queries.some((q) => q.table === 'sessions' && has(q, 'eq', 'teacher_id', TEACHER_ID)),
    ).toBe(false);
  });

  it.each([
    [
      '別校的班 → 403',
      { classRow: { id: CLASS_ID, campus_id: 'campus-2', is_active: true } },
      403,
      'FORBIDDEN',
    ],
    ['班級不在本 org → 404', { classRow: null }, 404, 'NOT_FOUND'],
    ['老師不在本 org → 404', { staffRow: null }, 404, 'TEACHER_NOT_FOUND'],
    [
      '班級停用 → 409',
      { classRow: { id: CLASS_ID, campus_id: 'campus-1', is_active: false } },
      409,
      'CLASS_INACTIVE',
    ],
    [
      '同班同時段已有課 → 409',
      { classPeers: [{ id: 'x', start_time: '20:00:00', end_time: '22:00:00' }] },
      409,
      'CLASS_CONFLICT',
    ],
    [
      '老師同時段已有課 → 409',
      { teacherPeers: [{ id: 'y', start_time: '18:00:00', end_time: '19:30:00' }] },
      409,
      'TEACHER_CONFLICT',
    ],
    [
      '撞唯一鍵（同時段的停課）→ 409',
      { insertError: { code: '23505', message: 'dup' } },
      409,
      'CLASS_CONFLICT',
    ],
  ] as const)('%s，而且不寫流水', async (_name, overrides, status, code) => {
    const { app, queries } = createApp(resolver(overrides as Overrides), ['campus-1']);
    const res = await post(app, body);
    expect(res.status).toBe(status);
    expect(((await res.json()) as { code: string }).code).toBe(code);
    expect(inserts(queries, 'schedule_changes')).toHaveLength(0);
  });

  it('結束早於開始 → 400 INVALID_TIME_RANGE，不建課', async () => {
    const { app, queries } = createApp(resolver());
    const res = await post(app, { ...body, startTime: '21:00', endTime: '19:00' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_TIME_RANGE');
    expect(inserts(queries, 'sessions')).toHaveLength(0);
  });

  it('流水寫失敗 → 刪掉剛建的課堂（補償），回 500', async () => {
    const { app, queries } = createApp(resolver({ logError: { message: 'boom' } }));
    const res = await post(app, body);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe('CREATE_LOG_FAILED');
    const deletes = queries.filter((q) => q.table === 'sessions' && has(q, 'delete'));
    expect(deletes).toHaveLength(1);
    expect(has(deletes[0], 'eq', 'id', NEW_ID)).toBe(true);
    expect(has(deletes[0], 'eq', 'org_id', 'org-1')).toBe(true);
  });
});

describe('GET /api/sessions/:id/changes —— 有真的 creation 列就不再合成（#1109）', () => {
  const sessionMeta = { id: NEW_ID, created_at: '2026-10-03T10:00:00+00:00', creator: null };
  const changeRow = (type: string) => ({
    id: `c-${type}`,
    change_type: type,
    created_at: '2026-10-03T10:00:01+00:00',
    staff: null,
  });

  const getChanges = async (rows: unknown[]) => {
    const { app } = createApp((q) =>
      q.table === 'sessions' ? { data: sessionMeta } : { data: rows },
    );
    const res = await app.request(`/api/sessions/${NEW_ID}/changes`);
    return ((await res.json()) as { data: Array<{ changeType: string }> }).data.map(
      (d) => d.changeType,
    );
  };

  it('加開的課堂：只有一筆 creation', async () => {
    expect(await getChanges([changeRow('creation')])).toEqual(['creation']);
  });

  it('批次產生的課堂（沒有 creation 列）：照舊合成一筆', async () => {
    expect(await getChanges([changeRow('substitute')])).toEqual(['substitute', 'creation']);
  });
});
