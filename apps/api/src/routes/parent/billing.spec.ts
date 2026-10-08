import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/taipei-date', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/taipei-date')>()),
  getCurrentTaipeiDateString: () => '2026-10-08',
}));

import billingRoute from './billing';
import { createChildDb } from '../../lib/child-db';
import { createMultiOrgDb } from '../../test-utils/multi-org-db';

const CHILD_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_CHILD_ID = '00000000-0000-0000-0000-000000000002';

function chainable(resolve: () => { data: unknown; error: unknown; count?: number }) {
  const obj: any = {
    eq: () => obj,
    range: () => obj,
    order: () => obj,
    lte: () => obj,
    gte: () => obj,
    limit: () => obj,
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
    orgPaymentInfo: async () => ({ paymentInfo: null, error: null }),
    // #1314 PP1：本學期查 billing_periods —— 這組測試不看它，回沒有學期
    orgRef: () => ({ select: () => chainable(() => ({ data: [], error: null })) }),
    from: () => ({
      pluck: async () => ({ rows: [], ids: [], error: null }),
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

  // #898 裁決 E：家長看得到作廢單（前端收合），但不計應繳 ——
  // 作廢單的 total − netPaid 是全額，算進去就是向家長要一筆不存在的錢
  it('作廢單列出、status 是 void、不帶作廢理由、不計入 totalDue', async () => {
    const VOIDED_INVOICE = {
      ...UNPAID_INVOICE,
      id: 'inv3',
      payment_records: [],
      voided_at: '2026-09-20T00:00:00Z',
      voided_by: 'staff-1',
      void_reason: '內部：開錯月份',
    };
    const res = await appWith(
      ['parent'],
      [CHILD_ID],
      fakeChildDb([UNPAID_INVOICE, VOIDED_INVOICE], [UNPAID_INVOICE, VOIDED_INVOICE]),
    ).request(`/?childId=${CHILD_ID}`);

    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };

    const voided = body.data.find((invoice) => invoice['id'] === 'inv3');
    expect(voided).toMatchObject({ status: 'void', voidedAt: '2026-09-20T00:00:00Z' });
    expect(voided).not.toHaveProperty('voidReason');
    expect(voided).not.toHaveProperty('voidedBy');
    expect(body.meta).toMatchObject({ totalDue: 600 });
  });

  // #1034：收 1,000、退 1,500 的帳單在家長端被算成「尚欠 1,500」、待付款合計多 1,500
  it('多退的帳單（淨額 < 0）列出、status 是 overrefunded、不計入 totalDue', async () => {
    const OVERREFUNDED_INVOICE = {
      ...UNPAID_INVOICE,
      id: 'inv4',
      payment_records: [
        { ...UNPAID_INVOICE.payment_records[0], id: 'pay4', amount: '1000' },
        {
          ...UNPAID_INVOICE.payment_records[0],
          id: 'ref4',
          kind: 'refund',
          amount: '1500',
          receipt_no: null,
        },
      ],
    };
    const res = await appWith(
      ['parent'],
      [CHILD_ID],
      fakeChildDb([UNPAID_INVOICE, OVERREFUNDED_INVOICE], [UNPAID_INVOICE, OVERREFUNDED_INVOICE]),
    ).request(`/?childId=${CHILD_ID}`);

    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };

    expect(body.data.find((invoice) => invoice['id'] === 'inv4')).toMatchObject({
      status: 'overrefunded',
      netPaid: -500,
    });
    // 只有 UNPAID_INVOICE 的 1,000 − 400 = 600
    expect(body.meta).toMatchObject({ totalDue: 600 });
  });
});

/**
 * #1073：待付款要列補習班帳戶資訊 —— 這個孩子**在籍**分校的生效值（分校覆寫 → 機構預設）。
 * 用真的 `createChildDb` 跑在照條件過濾的替身上：回固定資料的替身分不出 org／狀態條件有沒有下對。
 */
describe('GET /api/me/billing —— meta.paymentInfo（#1073）', () => {
  const ORG = 'org-1';

  async function run(tables: Record<string, Record<string, unknown>[]>) {
    const db = createMultiOrgDb({
      organizations: [
        { id: ORG, payment_info: '機構：台銀 004' },
        { id: 'org-2', payment_info: '別家的帳戶' },
      ],
      invoices: [],
      ...tables,
    });
    const childDb = createChildDb(db.client as never, [CHILD_ID], ORG);
    const res = await appWith(['parent'], [CHILD_ID], childDb).request(`/?childId=${CHILD_ID}`);
    const body = (await res.json()) as { meta: { paymentInfo: unknown } };
    return { status: res.status, paymentInfo: body.meta.paymentInfo };
  }

  it('在籍分校有覆寫 → 用分校的；退班的班與兄弟姊妹的班不算', async () => {
    const result = await run({
      enrollments: [
        { org_id: ORG, student_id: CHILD_ID, class_id: 'c-zz', status: 'active' },
        { org_id: ORG, student_id: CHILD_ID, class_id: 'c-xy', status: 'withdrawn' },
        { org_id: ORG, student_id: OTHER_CHILD_ID, class_id: 'c-xy', status: 'active' },
      ],
      classes: [
        { id: 'c-zz', org_id: ORG, campus_id: 'cp-zz' },
        { id: 'c-xy', org_id: ORG, campus_id: 'cp-xy' },
      ],
      campuses: [
        { id: 'cp-zz', org_id: ORG, name: '中正', payment_info: '中正專戶' },
        { id: 'cp-xy', org_id: ORG, name: '信義', payment_info: '信義專戶' },
      ],
    });

    expect(result.status).toBe(200);
    expect(result.paymentInfo).toEqual([{ campusName: null, text: '中正專戶' }]);
  });

  it('待繳費的報名也算在籍；分校沒覆寫 → 機構預設', async () => {
    const result = await run({
      enrollments: [
        { org_id: ORG, student_id: CHILD_ID, class_id: 'c-zz', status: 'pending_payment' },
      ],
      classes: [{ id: 'c-zz', org_id: ORG, campus_id: 'cp-zz' }],
      campuses: [{ id: 'cp-zz', org_id: ORG, name: '中正', payment_info: null }],
    });

    expect(result.paymentInfo).toEqual([{ campusName: null, text: '機構：台銀 004' }]);
  });

  it('沒有在籍報名 → 機構預設（不是別 org 的）', async () => {
    const result = await run({ enrollments: [], classes: [], campuses: [] });

    expect(result.paymentInfo).toEqual([{ campusName: null, text: '機構：台銀 004' }]);
  });
});

/**
 * #1314 PP1：「本學期已繳」＝**明細掛在本期的帳單**的淨收（收款－退款）。
 * 本期＝涵蓋台北今天的收費期間（重疊取開始日最晚的）；沒有就是 null。
 * 不用收款日：開學前先繳的要算、期內補繳上一期欠款的不算（計畫席 10-08 10:13 裁）。
 */
describe('GET /api/me/billing —— meta.term（#1314 PP1）', () => {
  const ORG = 'org-1';
  const period = (id: string, start: string, end: string, org = ORG) => ({
    id,
    org_id: org,
    name: `期 ${id}`,
    start_date: start,
    end_date: end,
  });
  const invoice = (
    periodIds: string[],
    payments: Array<{ kind: 'payment' | 'refund'; amount: number }>,
    over: Record<string, unknown> = {},
  ) => ({
    id: `inv-${Math.random()}`,
    org_id: ORG,
    student_id: CHILD_ID,
    issued_at: '2026-09-01',
    voided_at: null,
    invoice_items: periodIds.map((billing_period_id) => ({ amount: 5000, billing_period_id })),
    payment_records: payments.map((p) => ({ ...p, paid_at: '2026-09-15' })),
    ...over,
  });

  async function term(tables: Record<string, Record<string, unknown>[]>) {
    const db = createMultiOrgDb({
      organizations: [{ id: ORG, payment_info: null }],
      enrollments: [],
      billing_periods: [],
      invoices: [],
      ...tables,
    });
    const childDb = createChildDb(db.client as never, [CHILD_ID], ORG);
    const res = await appWith(['parent'], [CHILD_ID], childDb).request(`/?childId=${CHILD_ID}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { meta: { term: unknown } }).meta.term;
  }

  it('涵蓋今天的期：掛在本期的帳單淨收（退款扣回）；別期、作廢、兄弟姊妹的不算', async () => {
    const result = await term({
      billing_periods: [
        period('now', '2026-09-01', '2027-01-31'),
        period('prev', '2026-02-01', '2026-08-31'),
      ],
      invoices: [
        invoice(
          ['now'],
          [
            { kind: 'payment', amount: 5000 },
            { kind: 'refund', amount: 1000 },
          ],
        ),
        invoice(['now', 'prev'], [{ kind: 'payment', amount: 2000 }]),
        invoice(['prev'], [{ kind: 'payment', amount: 5000 }]),
        invoice(['now'], [], { voided_at: '2026-09-20T00:00:00Z' }),
        invoice(['now'], [{ kind: 'payment', amount: 9999 }], { student_id: OTHER_CHILD_ID }),
      ],
    });
    expect(result).toEqual({
      name: '期 now',
      startDate: '2026-09-01',
      endDate: '2027-01-31',
      paid: 6000,
    });
  });

  it('重疊的期取開始日最晚的；別 org 的期不算', async () => {
    const result = await term({
      billing_periods: [
        period('old', '2026-08-01', '2026-12-31'),
        period('new', '2026-10-01', '2027-02-28'),
        period('alien', '2026-10-05', '2027-03-31', 'org-2'),
      ],
    });
    expect(result).toMatchObject({ name: '期 new', paid: 0 });
  });

  it('沒有涵蓋今天的期 → null', async () => {
    const result = await term({ billing_periods: [period('later', '2026-11-01', '2027-01-31')] });
    expect(result).toBeNull();
  });
});
