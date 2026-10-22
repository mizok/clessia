import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { queueScheduleChangeNotice } from '../lib/notify-schedule';

import classesApp from './classes';

// #1693：課務異動通知的接線（收件人與內容由 notify-schedule.spec 守）
vi.mock('../lib/notify-schedule', () => ({
  queueScheduleChangeNotice: vi.fn(async () => undefined),
}));
const queued = vi.mocked(queueScheduleChangeNotice);
beforeEach(() => queued.mockClear());

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

function createApp(status = 'scheduled') {
  const queries: RecordedQuery[] = [];
  const resolve = (q: RecordedQuery) => {
    const has = (name: string) => q.ops.some((op) => op.name === name);
    // updated_by／ba_user：GET 班級的「最後修改者」（#1839）。嵌的 ba_user 是帳號名，員工姓名另外查
    if (q.table === 'classes')
      return {
        data: {
          id: CLASS,
          name: 'A 班',
          campus_id: 'campus-1',
          updated_by: 'u-editor',
          ba_user: { name: '帳號名' },
        },
      };
    // 衝突檢查（同班依日期、新老師的忙碌時段）回空：這份替身只管寫入的形狀
    const byDate = q.ops.some(
      (op) =>
        (op.name === 'in' && op.args[0] === 'session_date') ||
        (op.name === 'eq' && op.args[0] === 'teacher_id'),
    );
    if (q.table === 'sessions' && !has('update') && !byDate) {
      return {
        data: [S1, S2].map((id) => ({
          id,
          class_id: CLASS,
          session_date: '2026-10-20',
          start_time: '09:00:00',
          end_time: '11:00:00',
          status,
          teacher_id: null,
        })),
      };
    }
    if (q.table === 'ba_user')
      return {
        data: { name: '帳號名', staff: [{ display_name: '行政 A', org_id: 'org-1' }], parents: [] },
      };
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
      created_by_name: string | null;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.operation_source === 'batch')).toBe(true);
    // #1839：操作者名字取員工姓名（loadDisplayName），不是 profiles（沒有人寫了，新人一律是 null）
    expect(rows.every((r) => r.created_by_name === '行政 A')).toBe(true);
    expect(rows[0].batch_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(rows.map((r) => r.batch_id)).size).toBe(1);
    expect(queued).toHaveBeenCalledWith(expect.anything(), [
      { session_id: S1, change_type: 'cancellation', batch_id: rows[0].batch_id },
      { session_id: S2, change_type: 'cancellation', batch_id: rows[0].batch_id },
    ]);
  });
});

describe('POST /api/classes/{id}/cancel-future-sessions —— 寫稽核（#1336）', () => {
  it('停了幾堂就寫一筆 batch_cancel_session，帶筆數、classId、同一顆 batchId', async () => {
    const { app, queries } = createApp();
    const res = await app.request(`/api/classes/${CLASS}/cancel-future-sessions`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled: 2 });
    // logAudit 是 fire-and-forget（先查操作者名稱再寫），等它跑完
    await new Promise((r) => setTimeout(r, 0));

    const audit = queries.find((q) => q.table === 'audit_logs');
    const row = audit?.ops.find((op) => op.name === 'insert')?.args[0] as
      Record<string, any> | undefined;
    expect(row).toMatchObject({
      org_id: 'org-1',
      resource_type: 'class',
      resource_id: CLASS,
      action: 'batch_cancel_session',
      details: { requested: 2, updated: 2, classId: CLASS, scope: 'all_future' },
    });
    const changes = queries
      .find((q) => q.table === 'schedule_changes' && q.ops.some((op) => op.name === 'insert'))!
      .ops.find((op) => op.name === 'insert')!.args[0] as Array<{
      batch_id: string;
      created_by_name: string | null;
    }>;
    expect(row!['details'].batchId).toBe(changes[0]!.batch_id);
    // #1839：流水的操作者名字是員工姓名
    expect(changes.every((r) => r.created_by_name === '行政 A')).toBe(true);
    expect(queued).toHaveBeenCalledWith(
      expect.anything(),
      [S1, S2].map((s) => ({
        session_id: s,
        change_type: 'cancellation',
        batch_id: changes[0]!.batch_id,
      })),
    );
  });
});

describe('課務異動通知：不寫流水的兩支也通知（#1693 Q3），改時間照流水', () => {
  const send = (app: Hono, path: string, body: unknown) =>
    app.request(`/api/classes/${CLASS}/sessions/${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('批次改時間 → 每一堂都是 reschedule、同一顆 batch_id', async () => {
    const { app } = createApp();
    const res = await send(app, 'batch-update-time', {
      sessionIds: [S1, S2],
      startTime: '10:00',
      endTime: '12:00',
      dryRun: false,
    });
    expect(res.status).toBe(200);
    const rows = queued.mock.calls[0]![1];
    expect(rows.map((r) => [r.session_id, r.change_type])).toEqual([
      [S1, 'reschedule'],
      [S2, 'reschedule'],
    ]);
    expect(new Set(rows.map((r) => r.batch_id)).size).toBe(1);
  });

  it('批次復課 → uncancel', async () => {
    const { app } = createApp('cancelled');
    const res = await send(app, 'batch-uncancel', { sessionIds: [S1, S2], dryRun: false });
    expect(res.status).toBe(200);
    expect(queued.mock.calls[0]![1].map((r) => [r.session_id, r.change_type])).toEqual([
      [S1, 'uncancel'],
      [S2, 'uncancel'],
    ]);
  });

  it('批次換老師 → assign_teacher，帶新老師', async () => {
    const { app } = createApp();
    const res = await send(app, 'batch-assign-teacher', {
      from: '2026-10-01',
      to: '2026-10-31',
      toTeacherId: '44444444-4444-4444-8444-444444444444',
      mode: 'skip-conflicts',
      includeAssigned: true,
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect(queued.mock.calls[0]![1]).toEqual([
      expect.objectContaining({
        session_id: S1,
        change_type: 'assign_teacher',
        substitute_teacher_id: '44444444-4444-4444-8444-444444444444',
      }),
      expect.objectContaining({
        session_id: S2,
        change_type: 'assign_teacher',
        substitute_teacher_id: '44444444-4444-4444-8444-444444444444',
      }),
    ]);
  });
});

/**
 * #1839 二讀：班級的「最後修改者」是**別人**的名字（updated_by ≠ 請求者）。原本讀 profiles，
 * 新人一律拿不到。要拿到員工姓名，而不是退到班級查詢嵌的帳號名。
 */
describe('GET /api/classes/{id} —— 最後修改者用員工姓名（#1839）', () => {
  it('updatedByName 是修改者在本 org 的員工姓名（不是帳號名、不是 null）', async () => {
    const { app, queries } = createApp();
    const res = await app.request(`/api/classes/${CLASS}`);
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { data: { updatedByName: string | null } }).data.updatedByName,
    ).toBe('行政 A');
    const lookup = queries.find((q) => q.table === 'ba_user');
    expect(lookup?.ops).toContainEqual({ name: 'eq', args: ['id', 'u-editor'] });
  });
});
