import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import leavesApp, { cancelPlan } from './leaves';
import type { LeaveWindow } from '../lib/leave-covers-session';

/**
 * #1100 #33：取消請假前的影響預覽。`cancelPlan` 是預覽與 DELETE 共用的「會動哪一段」，
 * 路由用它的範圍去數這個學生的 `on_leave`：還沒點名的會被刪、已點名的不動。
 */
const TODAY = '2026-10-23';
const win = (over: Partial<LeaveWindow> = {}): LeaveWindow => ({
  startDate: '2026-10-20',
  endDate: '2026-10-25',
  startTime: null,
  endTime: null,
  boundSessions: [],
  ...over,
});

describe('cancelPlan', () => {
  it('進行中、沒綁定、起日在今天以前 → truncate：今天到迄日', () => {
    expect(cancelPlan('truncate', win(), TODAY)).toMatchObject({
      kind: 'truncate',
      from: TODAY,
      to: '2026-10-25',
    });
  });

  it('今天才開始 → 沒有過去可留，走 full（#1207）', () => {
    expect(cancelPlan('truncate', win({ startDate: TODAY }), TODAY)).toMatchObject({
      kind: 'full',
      from: TODAY,
    });
  });

  it('full 模式、已結束、未開始 → full：整張區間', () => {
    const cases: Array<['truncate' | 'full', LeaveWindow]> = [
      ['full', win()],
      ['truncate', win({ endDate: '2026-10-22' })],
      ['truncate', win({ startDate: '2026-10-24' })],
    ];
    for (const [mode, w] of cases)
      expect(cancelPlan(mode, w, TODAY)).toMatchObject({
        kind: 'full',
        from: w.startDate,
        to: w.endDate,
      });
  });

  it('綁定型、今天以前還有堂 → truncate-bound：只撤今天起的堂', () => {
    const plan = cancelPlan(
      'truncate',
      win({
        boundSessions: [
          { sessionId: 's-past', date: '2026-10-21' },
          { sessionId: 's-today', date: TODAY },
          { sessionId: 's-next', date: '2026-10-24' },
        ],
      }),
      TODAY,
    );
    expect(plan.kind).toBe('truncate-bound');
    if (plan.kind !== 'truncate-bound') return;
    expect(plan.kept.map((b) => b.sessionId)).toEqual(['s-past']);
    expect(plan.revert.boundSessions.map((b) => b.sessionId)).toEqual(['s-today', 's-next']);
    expect([plan.revert.startDate, plan.revert.endDate]).toEqual([TODAY, '2026-10-24']);
  });

  it('綁定型、今天以前沒有堂 → full', () => {
    expect(
      cancelPlan('truncate', win({ boundSessions: [{ sessionId: 's', date: TODAY }] }), TODAY).kind,
    ).toBe('full');
  });
});

describe('GET /api/leaves/:id/impact', () => {
  const LEAVE = '11111111-1111-4111-8111-111111111111';
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T04:00:00Z')); // 台北 10-23 中午
  });
  afterEach(() => vi.useRealTimers());

  function setup(opts: { found?: boolean; inScope?: boolean; campusScope?: string[] | null } = {}) {
    const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
    const data = (table: string) => {
      // 10-21（已點名）、10-23（今天，還沒點名）、10-24（還沒點名）三堂都有這個學生的 on_leave
      if (table === 'events')
        return [
          { id: 'e21', event_date: '2026-10-21', attendance_taken_at: '2026-10-21T10:00:00Z' },
          { id: 'e23', event_date: '2026-10-23', attendance_taken_at: null },
          { id: 'e24', event_date: '2026-10-24', attendance_taken_at: null },
        ].filter((e) => {
          const gte = [...calls].reverse().find((c) => c.table === 'events' && c.op === 'gte')
            ?.args[1];
          return !gte || e.event_date >= (gte as string);
        });
      // 照路由下的 in('event_id', …) 過濾，替身才分得出範圍對不對
      if (table === 'attendance_records') {
        const ids = [...calls]
          .reverse()
          .find((c) => c.table === 'attendance_records' && c.op === 'in')?.args[1] as string[];
        return ['e21', 'e23', 'e24']
          .filter((id) => ids.includes(id))
          .map((event_id) => ({ event_id }));
      }
      if (table === 'enrollments') return opts.inScope === false ? [] : [{ student_id: 'stu-1' }];
      return [];
    };
    const supabase = {
      from(table: string) {
        const b: Record<string, unknown> = {};
        for (const op of ['select', 'eq', 'in', 'gte', 'lte', 'limit', 'is'])
          b[op] = (...args: unknown[]) => (calls.push({ table, op, args }), b);
        b['maybeSingle'] = () =>
          Promise.resolve({
            data:
              table === 'leave_requests'
                ? opts.found === false
                  ? null
                  : {
                      id: LEAVE,
                      student_id: 'stu-1',
                      start_date: '2026-10-20',
                      end_date: '2026-10-25',
                      start_time: null,
                      end_time: null,
                      leave_request_sessions: [],
                    }
                : table === 'students'
                  ? { id: 'stu-1' }
                  : null,
            error: null,
          });
        b['then'] = (resolve: (v: unknown) => unknown) =>
          resolve({ data: data(table), error: null });
        return b;
      },
    };
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', supabase);
      set('orgId', 'org-1');
      set('userId', 'user-1');
      set('roles', ['admin']);
      set('campusScope', opts.campusScope ?? null);
      await next();
    });
    app.route('/', leavesApp);
    return { app, calls };
  }

  it('full：整張區間，已點名的 1 堂不動、還沒點名的 2 堂回到還沒點名', async () => {
    const { app, calls } = setup();
    const res = await app.request(`/${LEAVE}/impact?mode=full`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { revertCount: 2, keptCount: 1 } });
    expect(calls).toContainEqual({
      table: 'events',
      op: 'gte',
      args: ['event_date', '2026-10-20'],
    });
    // 只數這個學生、本 org、請假狀態
    const rec = calls.filter((c) => c.table === 'attendance_records');
    expect(rec).toEqual(
      expect.arrayContaining([
        { table: 'attendance_records', op: 'eq', args: ['org_id', 'org-1'] },
        { table: 'attendance_records', op: 'eq', args: ['student_id', 'stu-1'] },
        { table: 'attendance_records', op: 'eq', args: ['status', 'on_leave'] },
      ]),
    );
  });

  it('truncate（進行中）：從今天起算 —— 昨天以前已點名的那堂不在範圍', async () => {
    const { app, calls } = setup();
    const res = await app.request(`/${LEAVE}/impact?mode=truncate`);
    expect(calls).toContainEqual({ table: 'events', op: 'gte', args: ['event_date', TODAY] });
    expect(await res.json()).toEqual({ data: { revertCount: 2, keptCount: 0 } });
  });

  it('找不到（含別 org）→ 404', async () => {
    const { app, calls } = setup({ found: false });
    expect((await app.request(`/${LEAVE}/impact`)).status).toBe(404);
    expect(calls).toContainEqual({ table: 'leave_requests', op: 'eq', args: ['org_id', 'org-1'] });
  });

  it('受限管理員、學生不在範圍 → 403，不數', async () => {
    const { app, calls } = setup({ campusScope: ['campus-1'], inScope: false });
    expect((await app.request(`/${LEAVE}/impact`)).status).toBe(403);
    expect(calls.some((c) => c.table === 'events')).toBe(false);
  });
});
