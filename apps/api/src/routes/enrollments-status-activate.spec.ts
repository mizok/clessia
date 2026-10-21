import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';

/**
 * #1778 拆單 2（Q4）：行政手動把報名從 `pending_payment` 轉 `active`，連到它的
 * `awaiting_payment` 申請同一個交易轉 `completed`、記稽核、通知家長。
 * 交易本身在 `contract/record-payment.contract.ts` 對真 Postgres 驗，這裡替身掉。
 */

const h = vi.hoisted(() => ({
  pool: {} as unknown,
  activate: vi.fn(),
  notify: vi.fn(async () => undefined),
}));
vi.mock('../lib/get-auth', () => ({ getAuth: () => ({ pool: h.pool }) }));
vi.mock('../lib/record-payment', () => ({ activatePendingEnrollment: h.activate }));
vi.mock('../lib/notify-events', () => ({ notifyEnrollmentCompleted: h.notify }));
vi.mock('../lib/taipei-date', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/taipei-date')>()),
  getCurrentTaipeiDateString: () => '2026-10-21',
}));

const { default: enrollmentsRoute } = await import('./enrollments');

const ORG = '00000000-0000-0000-0000-00000000000a';
const ENR = '00000000-0000-0000-0000-000000000101';
const REQ = { id: 'req-1', studentId: 'stu-1', studentName: '小明', className: '數學A' };

async function patch(from: string, body: Record<string, unknown>) {
  const db = createMultiOrgDb({
    enrollments: [
      {
        id: ENR,
        org_id: ORG,
        class_id: 'cls-1',
        student_id: 'stu-1',
        status: from,
        effective_from: '2026-10-01',
        effective_to: null,
      },
    ],
    audit_logs: [],
  });
  const pending: Promise<unknown>[] = [];
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', null);
    await next();
  });
  app.route('/', enrollmentsRoute as unknown as Hono);
  const res = await app.request(
    `/${ENR}/status`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    {},
    {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException: () => {},
    } as never,
  );
  await Promise.all(pending);
  return { status: res.status, body: (await res.json()) as any, db };
}

describe('PATCH /api/enrollments/:id/status：待付款轉正式完成申請（#1778 拆單 2）', () => {
  beforeEach(() => {
    h.pool = {};
    h.activate.mockReset();
    h.notify.mockClear();
  });

  it('pending_payment → active：走交易、申請記一筆完成稽核、通知家長一次', async () => {
    h.activate.mockResolvedValue({ activated: true, completed: [REQ] });

    const { status, body, db } = await patch('pending_payment', { status: 'active' });

    expect(status).toBe(200);
    expect(body.data.status).toBe('active');
    expect(h.activate).toHaveBeenCalledWith(h.pool, {
      orgId: ORG,
      enrollmentId: ENR,
      today: '2026-10-21',
      reason: null,
    });
    const audit = db.rows('audit_logs').find((r) => r['resource_type'] === 'enrollment_request');
    expect(audit).toMatchObject({
      resource_id: 'req-1',
      action: 'complete',
      details: { via: 'manual', enrollment_id: ENR },
    });
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(expect.anything(), {
      orgId: ORG,
      requestId: 'req-1',
      studentId: 'stu-1',
      studentName: '小明',
      className: '數學A',
    });
  });

  it.each([
    ['suspended', 'active'],
    ['active', 'suspended'],
    ['pending_payment', 'withdrawal'],
  ])('%s → %s：不走交易、不通知', async (from, to) => {
    const { status } = await patch(from, { status: to, notes: '原因' });

    expect(status).toBe(200);
    expect(h.activate).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('pg 池不在 → 500，不退回逐句寫（pg-pool-writes rule 6）', async () => {
    h.pool = null;

    const { status, body, db } = await patch('pending_payment', { status: 'active' });

    expect(status).toBe(500);
    expect(body.error).toBe('DB_POOL_UNAVAILABLE');
    expect(db.rows('enrollments')[0]!['status']).toBe('pending_payment');
  });
});
