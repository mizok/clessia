import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';

/**
 * #1778：`POST /api/invoices/{id}/payments` 的路由層 —— 交易結果怎麼對成 HTTP、稽核與家長通知。
 * 交易本身（鎖帳單、退費上限、報名轉正式、申請完成、併發）在 `contract/record-payment.contract.ts`
 * 對真 Postgres 驗，這裡替身掉。
 */

const h = vi.hoisted(() => ({
  pool: {} as unknown,
  record: vi.fn(),
  notify: vi.fn(async () => undefined),
}));
vi.mock('../lib/get-auth', () => ({ getAuth: () => ({ pool: h.pool }) }));
vi.mock('../lib/record-payment', () => ({ recordPayment: h.record }));
vi.mock('../lib/notify-events', () => ({ notifyEnrollmentCompleted: h.notify }));
vi.mock('../lib/taipei-date', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/taipei-date')>()),
  getCurrentTaipeiDateString: () => '2026-10-21',
}));

const { default: invoicesRoute } = await import('./invoices');

const ORG = '00000000-0000-0000-0000-00000000000a';
const INVOICE = '00000000-0000-0000-0000-000000000101';
const ROW = {
  id: 'enr-1',
  studentId: 'stu-1',
  studentName: '小明',
  className: '數學A',
  classId: 'cls-1',
  effectiveFrom: '2026-10-01',
  effectiveTo: null,
};
const REQ = { id: 'req-1', studentId: 'stu-1', studentName: '小明', className: '數學A' };

/**
 * 回補請假出勤（`lib/enrollment-leave-sync.ts`）讀寫的三張表：讀的那兩張給固定資料，
 * 寫的那張收下 upsert 的列。查詢鏈的每一步都回自己，`await` 時給 `result`。
 */
function chain(result: unknown, onUpsert?: (rows: unknown) => void): unknown {
  const self: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'lte', 'in']) self[m] = () => self;
  self['upsert'] = (rows: unknown) => {
    onUpsert?.(rows);
    return Promise.resolve({ error: null });
  };
  self['then'] = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
  return self;
}

/** 學生 10/25 請了一整天假（沒綁堂次），這班 10/25 有一堂沒停課 */
const LEAVE_FIXTURES: Record<string, unknown> = {
  leave_requests: [
    { start_date: '2026-10-25', end_date: '2026-10-25', leave_request_sessions: [] },
  ],
  events: [
    { id: 'ev-25', event_date: '2026-10-25', sessions: { class_id: 'cls-1', status: 'scheduled' } },
  ],
};

async function call(body: Record<string, unknown>) {
  const upserted: unknown[] = [];
  const db = createMultiOrgDb({
    invoices: [{ id: INVOICE, org_id: ORG, student_id: 'stu-1', voided_at: null }],
    audit_logs: [],
    profiles: [],
  });
  const pending: Promise<unknown>[] = [];
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    const base = db.client as { from: (t: string) => unknown };
    set('supabase', {
      ...base,
      from: (t: string) =>
        t === 'attendance_records'
          ? chain({ error: null }, (rows) => upserted.push(...(rows as unknown[])))
          : t in LEAVE_FIXTURES
            ? chain({ data: LEAVE_FIXTURES[t], error: null })
            : base.from(t),
    });
    set('orgId', ORG);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', null);
    await next();
  });
  app.route('/', invoicesRoute as unknown as Hono);
  const res = await app.request(
    `/${INVOICE}/payments`,
    {
      method: 'POST',
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
  return { status: res.status, body: (await res.json()) as any, db, upserted };
}

describe('POST /api/invoices/{id}/payments（#1778）', () => {
  beforeEach(() => {
    h.pool = {};
    h.record.mockReset();
    h.notify.mockClear();
  });

  it('收款：送進交易的參數（kind 預設 payment、paidAt 預設台北今天、org 取自登入）', async () => {
    h.record.mockResolvedValue({ status: 'done', paymentId: 'p-1', activated: [], completed: [] });

    const { status } = await call({ amount: 1000, method: 'cash' });

    expect(status).toBe(201);
    expect(h.record).toHaveBeenCalledWith(h.pool, {
      orgId: ORG,
      userId: 'admin-a',
      invoiceId: INVOICE,
      kind: 'payment',
      amount: 1000,
      method: 'cash',
      paidAt: '2026-10-21',
      proofPath: null,
      note: null,
      today: '2026-10-21',
    });
  });

  it('轉正式＋完成：回應帶出兩群、各記一筆稽核、每筆完成的申請通知一次家長', async () => {
    h.record.mockResolvedValue({
      status: 'done',
      paymentId: 'p-1',
      activated: [ROW],
      completed: [REQ],
    });

    const { status, body, db } = await call({ amount: 3000, method: 'cash' });

    expect(status).toBe(201);
    expect(body.activatedEnrollments).toEqual([ROW]);
    expect(body.completedRequests).toEqual([REQ]);
    expect(
      db.rows('audit_logs').map((r) => [r['resource_type'], r['resource_id'], r['action']]),
    ).toEqual(
      expect.arrayContaining([
        ['payment_record', INVOICE, 'payment'],
        ['enrollment', 'enr-1', 'update'],
        ['enrollment_request', 'req-1', 'complete'],
      ]),
    );
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(expect.anything(), {
      orgId: ORG,
      requestId: 'req-1',
      studentId: 'stu-1',
      studentName: '小明',
      className: '數學A',
    });
  });

  it('收款轉正式之後，既有的整天假回補成 on_leave（跟手動轉 active 同一個副作用）', async () => {
    h.record.mockResolvedValue({
      status: 'done',
      paymentId: 'p-1',
      activated: [ROW],
      completed: [],
    });

    const { status, upserted } = await call({ amount: 1000, method: 'cash' });

    expect(status).toBe(201);
    expect(upserted).toEqual([
      expect.objectContaining({
        org_id: ORG,
        student_id: 'stu-1',
        event_id: 'ev-25',
        status: 'on_leave',
        recorded_by: 'admin-a',
      }),
    ]);
  });

  it('沒有轉任何東西（例如退費）：不通知、只有收款那筆稽核', async () => {
    h.record.mockResolvedValue({ status: 'done', paymentId: 'p-1', activated: [], completed: [] });

    const { body, db, upserted } = await call({ kind: 'refund', amount: 100, method: 'cash' });

    expect(body).toMatchObject({ activatedEnrollments: [], completedRequests: [] });
    expect(h.notify).not.toHaveBeenCalled();
    expect(db.rows('audit_logs').map((r) => r['action'])).toEqual(['refund']);
    expect(upserted).toEqual([]);
  });

  it('退費超過已收淨額 → 409，訊息說得出已收多少、最多可退多少', async () => {
    h.record.mockResolvedValue({ status: 'refund-exceeds-paid', net: 1000 });

    const { status, body } = await call({ kind: 'refund', amount: 1500, method: 'cash' });

    expect(status).toBe(409);
    expect(body.code).toBe('REFUND_EXCEEDS_PAID');
    expect(body.error).toContain('已收淨額 1,000 元，最多可退 1,000 元');
  });

  it.each([
    [{ status: 'not-found' }, 404, 'NOT_FOUND'],
    [{ status: 'voided' }, 409, 'INVOICE_VOIDED'],
  ])('交易回 %o → %i %s', async (outcome, code, errorCode) => {
    h.record.mockResolvedValue(outcome);

    const { status, body } = await call({ amount: 100, method: 'cash' });

    expect(status).toBe(code);
    expect(body.code).toBe(errorCode);
  });

  it('交易丟例外 → 500，不通知', async () => {
    h.record.mockRejectedValue(new Error('boom'));

    const { status } = await call({ amount: 100, method: 'cash' });

    expect(status).toBe(500);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('pg 池不在 → 500，不退回逐句寫（pg-pool-writes rule 6）', async () => {
    h.pool = null;

    const { status, body } = await call({ amount: 100, method: 'cash' });

    expect(status).toBe(500);
    expect(body.code).toBe('DB_POOL_UNAVAILABLE');
    expect(h.record).not.toHaveBeenCalled();
  });
});
