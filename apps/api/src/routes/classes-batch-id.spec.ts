import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import classesApp from './classes';

/**
 * 班級頁的批次停課（`PATCH /classes/{id}/sessions/batch-cancel`）寫流水時要標成批次（#1195）。
 * 原本沒寫 `operation_source`，DB 預設 `single` —— /admin/changes 把 14 堂一起停課記成 14 筆單堂停課。
 */
interface RecordedQuery {
  readonly table: string;
  readonly ops: Array<{ name: string; args: unknown[] }>;
}

const CLASS = '11111111-1111-4111-8111-111111111111';
const S1 = '22222222-2222-4222-8222-222222222222';
const S2 = '33333333-3333-4333-8333-333333333333';

function createApp() {
  const queries: RecordedQuery[] = [];
  const resolve = (q: RecordedQuery) => {
    const has = (name: string) => q.ops.some((op) => op.name === name);
    if (q.table === 'classes') return { data: { id: CLASS, name: 'A 班', campus_id: 'campus-1' } };
    if (q.table === 'sessions' && !has('update')) {
      return {
        data: [S1, S2].map((id) => ({
          id,
          class_id: CLASS,
          session_date: '2026-10-20',
          start_time: '09:00:00',
          end_time: '11:00:00',
          status: 'scheduled',
          teacher_id: null,
        })),
      };
    }
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
  app.route('/api/classes', classesApp);
  return { app, queries };
}

describe('PATCH /api/classes/{id}/sessions/batch-cancel —— 流水標成批次（#1195）', () => {
  it('每列 operation_source=batch、共用同一顆 batch_id', async () => {
    const { app, queries } = createApp();
    const res = await app.request(`/api/classes/${CLASS}/sessions/batch-cancel`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: [S1, S2], dryRun: false }),
    });
    expect(res.status).toBe(200);
    const insert = queries.find(
      (q) => q.table === 'schedule_changes' && q.ops.some((op) => op.name === 'insert'),
    );
    const rows = insert!.ops.find((op) => op.name === 'insert')!.args[0] as Array<{
      operation_source: string;
      batch_id: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.operation_source === 'batch')).toBe(true);
    expect(rows[0].batch_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(rows.map((r) => r.batch_id)).size).toBe(1);
  });
});
