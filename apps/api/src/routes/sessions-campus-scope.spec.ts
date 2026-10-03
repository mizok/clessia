import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import sessionsApp from './sessions';

/**
 * sessions 寫入端點的分校範圍（#1221）：path／body 只帶課堂 id，全域 campusRequestGuard
 * 看不到分校，要從課堂的班級解出來比。單堂不在範圍 → 403；批次任一堂不在範圍 → 整批 403。
 *
 * 替身不看條件：每張表回固定 fixture，分校靠 fixture 的 campus_id 對 campusScope。
 */
interface RecordedQuery {
  readonly table: string;
  readonly ops: string[];
}

function createApp(classCampus: string, campusScope: string[] | null) {
  const queries: RecordedQuery[] = [];
  const sessionRow = {
    id: SESSION_ID,
    class_id: 'class-1',
    session_date: '2026-10-20',
    start_time: '09:00:00',
    end_time: '11:00:00',
    status: 'scheduled',
    assignment_status: 'assigned',
    teacher_id: 'teacher-1',
    classes: { campus_id: classCampus },
    class: { name: '數學 A', campus_id: classCampus, course: null },
    teacher: null,
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
              const data =
                table === 'sessions'
                  ? recorded.ops.includes('maybeSingle')
                    ? sessionRow
                    : recorded.ops.includes('in')
                      ? [sessionRow]
                      : []
                  : null;
              return (onfulfilled?: (value: unknown) => unknown) =>
                Promise.resolve({ data, error: null }).then(onfulfilled);
            }
            return () => {
              recorded.ops.push(prop);
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

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const TEACHER = '22222222-2222-4222-8222-222222222222';

const cases = [
  ['POST', `${SESSION_ID}/cancel`, { reason: '颱風' }],
  ['POST', `${SESSION_ID}/substitute`, { substituteTeacherId: TEACHER }],
  [
    'POST',
    `${SESSION_ID}/reschedule`,
    { newSessionDate: '2026-10-21', newStartTime: '10:00', newEndTime: '12:00' },
  ],
  [
    'PATCH',
    'batch-update-time',
    { sessionIds: [SESSION_ID], startTime: '10:00', endTime: '12:00', dryRun: false },
  ],
  ['PATCH', 'batch-cancel', { sessionIds: [SESSION_ID], dryRun: false }],
  ['PATCH', 'batch-uncancel', { sessionIds: [SESSION_ID], dryRun: false }],
] as const;

const send = (app: Hono, method: string, path: string, body: unknown) =>
  app.request(`/api/sessions/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const writes = (queries: RecordedQuery[]) =>
  queries.filter(
    (q) => q.table !== 'audit_logs' && (q.ops.includes('update') || q.ops.includes('insert')),
  );

describe('sessions 寫入端點的分校範圍（#1221）', () => {
  it.each(cases)('%s %s：別校 → 403 FORBIDDEN，不寫入', async (method, path, body) => {
    const { app, queries } = createApp('campus-2', ['campus-1']);
    const res = await send(app, method, path, body);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
    expect(writes(queries)).toHaveLength(0);
  });

  it.each(cases)('%s %s：同校的受限管理員不被分校擋', async (method, path, body) => {
    const { app } = createApp('campus-1', ['campus-1']);
    const res = await send(app, method, path, body);
    expect(res.status).not.toBe(403);
  });

  it.each(cases)('%s %s：不受限的管理員不被分校擋', async (method, path, body) => {
    const { app } = createApp('campus-2', null);
    const res = await send(app, method, path, body);
    expect(res.status).not.toBe(403);
  });
});
