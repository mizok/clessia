import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import { restBackedLeavePool } from '../test-utils/rest-backed-leave-pool';
import leavesApp from './leaves';

/**
 * Cloudflare Workers 免費方案：**每個請求最多 50 個 subrequest**（push-run.ts、staff-digests.ts 也記過），
 * supabase-js 每一次查詢就是一個。本機沒有這個上限，超過了只會在正式站「跑到一半失敗」。
 *
 * 批次請假（#1100 #32）因此改成前端逐位呼叫單筆 POST（每位一個請求、各自的額度）。
 * 這支守住單筆 POST 本身：通知、連續請假偵測都用**真的**模組（waitUntil 的工作也算在同一個請求裡）。
 * 2026-10-23 量測是 23 次 —— 已經快一半。單筆路徑再加查詢前先看這裡；過 45 就該改走 pg pool。
 *
 * #1969 起「取鎖 → 查重疊 → 寫入」走 pg pool 的交易（沒有 pool 回 500）。pool 的 SQL 不是 supabase-js 的
 * subrequest，但**保守起見每開一條連線算 1**（Hyperdrive 連線）；pool 替身翻成 REST 的那些呼叫走另一個
 * 不計數的 client，不重複算。
 */
const ORG = '00000000-0000-0000-0000-00000000000a';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const STU = id(1);
const CLS = id(11);
const S = id(101);
const D = '2026-10-06';

describe('POST /api/leaves 的 subrequest 預算（Workers 上限 50）', () => {
  it('建一張綁一堂的假（含通知、連續請假偵測）≤ 45 次查詢', async () => {
    const db = createMultiOrgDb({
      students: [{ id: STU, org_id: ORG, name: '王小明' }],
      enrollments: [
        {
          org_id: ORG,
          student_id: STU,
          class_id: CLS,
          status: 'active',
          effective_from: '2026-01-01',
          effective_to: null,
        },
      ],
      sessions: [
        {
          id: S,
          org_id: ORG,
          class_id: CLS,
          session_date: D,
          start_time: '09:00:00',
          end_time: '11:00:00',
          status: 'scheduled',
        },
      ],
      events: [
        {
          id: id(201),
          org_id: ORG,
          event_type: 'session',
          event_date: D,
          start_time: '09:00:00',
          end_time: '11:00:00',
          attendance_taken_at: null,
          sessions: { id: S, class_id: CLS, status: 'scheduled' },
        },
      ],
      leave_requests: [],
      leave_request_sessions: [],
      attendance_records: [],
      audit_logs: [],
      profiles: [],
    });
    let queries = 0;
    const client = new Proxy(db.client as Record<string, unknown>, {
      get(target, prop) {
        const value = target[prop as string];
        if (prop === 'from' || prop === 'rpc')
          return (...args: unknown[]) => {
            queries++;
            return (value as (...a: unknown[]) => unknown)(...args);
          };
        return value;
      },
    });
    const base = restBackedLeavePool(db.client as Parameters<typeof restBackedLeavePool>[0]);
    let connections = 0;
    const pool = {
      ...base,
      connect: async () => {
        connections++;
        return base.connect();
      },
    };
    const waits: Promise<unknown>[] = [];
    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', client);
      set('orgId', ORG);
      set('campusScope', null);
      set('userId', 'user-1');
      set('roles', ['admin']);
      set('auth', { pool });
      await next();
    });
    app.route('/api/leaves', leavesApp);

    const res = await app.request(
      '/api/leaves',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentId: STU, startDate: D, endDate: D, sessionIds: [S] }),
      },
      {},
      {
        waitUntil: (p: Promise<unknown>) => waits.push(p),
        passThroughOnException: () => undefined,
      } as never,
    );
    await Promise.allSettled(waits);

    expect(res.status).toBe(201);
    // 真的走了 pool 的寫入交易（不是退回別條路）
    expect(base.statements).toContain('BEGIN');
    expect(base.statements).toContain('COMMIT');
    // 真的有走完（不是一開始就失敗的低數字）
    expect(queries).toBeGreaterThan(10);
    expect(queries + connections).toBeLessThanOrEqual(45);
  });
});
