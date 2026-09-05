import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import billingRoute from './billing';

const CHILD_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_CHILD_ID = '00000000-0000-0000-0000-000000000002';

function chainable(resolve: () => { data: unknown; error: unknown; count?: number }) {
  const obj: any = {
    eq: () => obj,
    range: () => obj,
    order: () => obj,
    then: (onfulfilled: (value: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onfulfilled),
  };
  return obj;
}

/** 未繳清：明細 1000、收款 400 —— total 1000、netPaid 400、status 'partial' */
const UNPAID_INVOICE = {
  id: 'inv1',
  org_id: 'org-1',
  student_id: CHILD_ID,
  issued_at: '2026-09-01',
  due_date: '2026-09-15',
  note: '家長來電抱怨延遲繳費',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  invoice_items: [
    {
      id: 'item1',
      type: 'tuition',
      amount: '1000',
      enrollment_id: null,
      billing_period_id: null,
      period_month: '2026-09-01',
      note: '內部備註：特殊減免案',
    },
  ],
  payment_records: [
    {
      id: 'pay1',
      kind: 'payment',
      amount: '400',
      method: 'cash',
      paid_at: '2026-09-02',
      proof_path: '/internal/proof/1.jpg',
      receipt_no: 42,
      note: '內部備註',
      recorded_by: 'staff-1',
    },
  ],
};

/** 已繳清：明細 500、收款 500 —— 不計入 totalDue */
const PAID_INVOICE = {
  id: 'inv2',
  org_id: 'org-1',
  student_id: CHILD_ID,
  issued_at: '2026-08-01',
  due_date: '2026-08-15',
  note: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  invoice_items: [
    {
      id: 'item2',
      type: 'tuition',
      amount: '500',
      enrollment_id: null,
      billing_period_id: null,
      period_month: '2026-08-01',
      note: null,
    },
  ],
  payment_records: [
    {
      id: 'pay2',
      kind: 'payment',
      amount: '500',
      method: 'cash',
      paid_at: '2026-08-02',
      proof_path: null,
      receipt_no: 43,
      note: null,
      recorded_by: 'staff-1',
    },
  ],
};

function fakeChildDb(pageInvoices: unknown[], allInvoices: unknown[]) {
  return {
    from: () => ({
      select: (_cols: string, opts?: { count?: string }) => {
        // 分頁那支帶 { count: 'exact' }，totalDue 那支不帶 —— 用這個分辨兩種呼叫
        const rows = opts?.count ? pageInvoices : allInvoices;
        return chainable(() => ({ data: rows, error: null, count: pageInvoices.length }));
      },
    }),
  };
}

function appWith(roles: string[], studentScope: readonly string[] | null, childDb: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', roles);
    set('studentScope', studentScope);
    set('childDb', childDb);
    await next();
  });
  app.route('/', billingRoute as unknown as Hono);
  return app;
}

describe('GET /api/me/billing', () => {
  it('不是家長身分回 403', async () => {
    const res = await appWith(['teacher'], [CHILD_ID], fakeChildDb([], [])).request(
      `/?childId=${CHILD_ID}`,
    );
    expect(res.status).toBe(403);
  });

  it('childId 不在 studentScope 裡回 403', async () => {
    const res = await appWith(['parent'], [OTHER_CHILD_ID], fakeChildDb([], [])).request(
      `/?childId=${CHILD_ID}`,
    );
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'CHILD_OUT_OF_SCOPE' });
  });

  it('內部備註、經手人、憑證路徑不外流；totalDue 只算未繳清的帳單', async () => {
    const res = await appWith(
      ['parent'],
      [CHILD_ID],
      fakeChildDb([UNPAID_INVOICE, PAID_INVOICE], [UNPAID_INVOICE, PAID_INVOICE]),
    ).request(`/?childId=${CHILD_ID}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };

    expect(body.data).toHaveLength(2);
    const [unpaid] = body.data;
    expect(unpaid).not.toHaveProperty('note');
    expect((unpaid['items'] as Array<Record<string, unknown>>)[0]).not.toHaveProperty('note');
    const payment = (unpaid['payments'] as Array<Record<string, unknown>>)[0];
    expect(payment).not.toHaveProperty('note');
    expect(payment).not.toHaveProperty('recordedBy');
    expect(payment).not.toHaveProperty('proofPath');
    expect(unpaid).toMatchObject({ status: 'partial', total: 1000, netPaid: 400 });

    // 只有未繳清那筆的 (total - netPaid) = 600 算進 totalDue，已繳清的不算
    expect(body.meta).toMatchObject({ totalDue: 600 });
  });
});
