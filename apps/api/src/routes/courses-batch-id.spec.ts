import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import coursesApp from './courses';

/**
 * 課程停用連帶取消未來課堂（`PUT /courses/{id}`，`deactivateMode: 'cancel_future_sessions'`）
 * 寫流水時要標成批次（#1195）—— 跟班級停用同形。原本沒寫 `operation_source`，DB 預設 `single`，
 * /admin/changes 把「停一門課」記成底下每一堂各自的單堂停課。
 */
interface RecordedQuery {
  readonly table: string;
  readonly ops: Array<{ name: string; args: unknown[] }>;
}

const COURSE = '11111111-1111-4111-8111-111111111111';
const CLASS = '44444444-4444-4444-8444-444444444444';
const S1 = '22222222-2222-4222-8222-222222222222';
const S2 = '33333333-3333-4333-8333-333333333333';

function createApp() {
  const queries: RecordedQuery[] = [];
  const resolve = (q: RecordedQuery) => {
    const has = (name: string) => q.ops.some((op) => op.name === name);
    if (q.table === 'courses' && has('update')) {
      return {
        data: { id: COURSE, name: '國中數學', is_active: false, campuses: { name: '信義校' } },
      };
    }
    if (q.table === 'courses') return { data: { id: COURSE, is_active: true } };
    if (q.table === 'classes') return { data: [{ id: CLASS }] };
    if (q.table === 'sessions' && !has('update')) return { data: [{ id: S1 }, { id: S2 }] };
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
                Promise.resolve({ error: null, ...resolve(recorded) }).then(onfulfilled);
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
    ctx.set('campusScope', null);
    await next();
  });
  app.route('/api/courses', coursesApp);
  return { app, queries };
}

describe('PUT /api/courses/{id} 停用並取消未來課堂 —— 流水標成批次（#1195）', () => {
  it('每列 operation_source=batch、共用同一顆 batch_id', async () => {
    const { app, queries } = createApp();
    const res = await app.request(
      `/api/courses/${COURSE}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false, deactivateMode: 'cancel_future_sessions' }),
      },
      {},
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
    );

    expect(res.status).toBe(200);
    const insert = queries.find(
      (q) => q.table === 'schedule_changes' && q.ops.some((op) => op.name === 'insert'),
    );
    const rows = insert!.ops.find((op) => op.name === 'insert')!.args[0] as Array<{
      operation_source: string;
      batch_id: string;
      reason: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.operation_source === 'batch')).toBe(true);
    expect(rows[0]!.batch_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(rows.map((r) => r.batch_id)).size).toBe(1);
    expect(rows[0]!.reason).toBe('課程停用');
  });
});
