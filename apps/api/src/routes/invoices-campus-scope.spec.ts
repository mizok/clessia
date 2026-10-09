import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/taipei-date', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/taipei-date')>()),
  getCurrentTaipeiDateString: () => '2026-10-08',
}));

import { createMultiOrgDb, withMaxRows } from '../test-utils/multi-org-db';
import invoicesRoute from './invoices';

/**
 * 帳單的分校範圍（#1381）。判準在 `lib/invoice-campus-scope.ts`：學生在範圍內
 * ＋有班的明細全在範圍內；沒有班的明細（餐費）不讓整張失格。範圍外一律 404。
 *
 * `multi-org-db` 不解析 select，所以帳單列直接帶 `INVOICE_SCOPE_EMBED` 的 alias 欄位
 * （`scope_student`／`scope_items`）—— select 字串本身由本機實打驗（見 PR）。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const CA = '00000000-0000-0000-0000-0000000000ca';
const CB = '00000000-0000-0000-0000-0000000000cb';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const SA = id(101); // A 校學生
const SB = id(102); // 只在 B 校的學生
const EA = id(201); // SA 在 A 校的報名
const EB = id(202); // SA 在 B 校的報名（跨校學生）
const EB2 = id(203); // SB 在 B 校的報名

const enrollmentsOf = { [SA]: [EA, EB], [SB]: [EB2] } as const;
const campusOfEnrollment: Record<string, string> = { [EA]: CA, [EB]: CB, [EB2]: CB };
const classOf = (e: string | null) =>
  e ? { classes: { campus_id: campusOfEnrollment[e] } } : null;

/** 一張帳單：明細只給報名 id（null = 餐費） */
function invoice(n: number, student: string, itemEnrollments: Array<string | null>) {
  return {
    id: id(n),
    org_id: ORG,
    student_id: student,
    issued_at: '2026-10-01',
    due_date: null,
    voided_at: null,
    note: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    students: { name: student === SA ? '甲' : '乙' },
    invoice_items: itemEnrollments.map((e, i) => ({
      id: id(n * 10 + i),
      type: e ? 'tuition' : 'meal',
      enrollment_id: e,
      amount: '1000',
    })),
    payment_records: [],
    scope_student: {
      enrollments: enrollmentsOf[student as keyof typeof enrollmentsOf].map(classOf),
    },
    scope_items: itemEnrollments.map((e) => ({ enrollments: classOf(e) })),
  };
}

const VISIBLE = id(1); // A 學生、A 班
const CROSS = id(2); // A 學生、A 班＋B 班 —— 跨校
const MEAL_A = id(3); // A 學生、只有餐費
const MEAL_B = id(4); // B 學生、只有餐費
const OTHER = id(5); // B 學生、B 班

function seed(extraInvoices: Array<ReturnType<typeof invoice>> = []) {
  const invoices = [
    invoice(1, SA, [EA]),
    invoice(2, SA, [EA, EB]),
    invoice(3, SA, [null]),
    invoice(4, SB, [null]),
    invoice(5, SB, [EB2]),
    ...extraInvoices,
  ];
  return createMultiOrgDb({
    invoices,
    invoice_items: invoices.flatMap((inv) =>
      inv.invoice_items.map((item) => ({
        ...item,
        invoice_id: inv.id,
      })),
    ),
    payment_records: [],
    payment_reminders: [],
    students: [
      { id: SA, org_id: ORG, name: '甲', enrollments: enrollmentsOf[SA].map(classOf) },
      { id: SB, org_id: ORG, name: '乙', enrollments: enrollmentsOf[SB].map(classOf) },
    ],
    enrollments: [EA, EB, EB2].map((e) => ({ id: e, org_id: ORG, ...classOf(e) })),
    organizations: [{ id: ORG, invoice_due_days: 14 }],
  });
}

type Db = ReturnType<typeof seed>;

async function call(
  db: Db,
  method: string,
  path: string,
  opts: { scope?: readonly string[] | null; body?: unknown; maxRows?: number } = {},
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', opts.maxRows ? withMaxRows(db.client, opts.maxRows) : db.client);
    set('orgId', ORG);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['manage_finance']);
    set('campusScope', opts.scope === undefined ? [CA] : opts.scope);
    await next();
  });
  app.route('/', invoicesRoute as unknown as Hono);
  const res = await app.request(path, {
    method,
    ...(opts.body
      ? { body: JSON.stringify(opts.body), headers: { 'content-type': 'application/json' } }
      : {}),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe('帳單的分校範圍（#1381）—— 讀', () => {
  it('列表：受限者只見 A 學生且明細都在 A 的單；餐費不讓整張失格；跨校單不見', async () => {
    const { status, body } = await call(seed(), 'GET', '/');
    expect(status).toBe(200);
    expect(body.data.map((r: { id: string }) => r.id).sort()).toEqual([VISIBLE, MEAL_A]);
    expect(body.meta.total).toBe(2);
  });

  it('列表：meta.total 是篩後全體，不是 DB 的筆數（pageSize=1）', async () => {
    const { body } = await call(seed(), 'GET', '/?page=1&pageSize=1');
    expect(body.data).toHaveLength(1);
    expect(body.meta.total).toBe(2);
  });

  it('列表：不受限的看得到全部', async () => {
    const { body } = await call(seed(), 'GET', '/', { scope: null });
    expect(body.meta.total).toBe(5);
  });

  it('列表：一個分校都沒被指派 → 空（fail-closed）', async () => {
    const { body } = await call(seed(), 'GET', '/', { scope: [] });
    expect(body.meta.total).toBe(0);
  });

  // 陷阱：PostgREST 撈列只回前 1000 列、不報錯 —— 受限者走推導路徑，要撈到底
  it('列表：範圍內帳單破千，1001 張都在 total 裡', async () => {
    const more = Array.from({ length: 999 }, (_, i) => invoice(10_000 + i, SA, [EA]));
    const { body } = await call(seed(more), 'GET', '/', { maxRows: 1000 });
    expect(body.meta.total).toBe(1001);
  });

  it('彙總：跟列表同一個範圍', async () => {
    const { status, body } = await call(seed(), 'GET', '/summary');
    expect(status).toBe(200);
    expect(body.byStatus.unpaid).toEqual({ count: 2, outstanding: 2000 });
  });

  it('彙總帶 studentId：範圍外的學生回全零（不是 403／404，同列表）', async () => {
    const { status, body } = await call(seed(), 'GET', `/summary?studentId=${SB}`);
    expect(status).toBe(200);
    expect(body.outstanding).toBe(0);
    expect(body.byStatus.unpaid).toEqual({ count: 0, outstanding: 0 });
    // 對照：不受限時同一位學生有兩張（MEAL_B、OTHER），證明全零來自範圍不是沒資料
    const open = await call(seed(), 'GET', `/summary?studentId=${SB}`, { scope: null });
    expect(open.body.outstanding).toBe(2000);
  });

  it('單筆：範圍內 200、範圍外（含跨校）404', async () => {
    const db = seed();
    expect((await call(db, 'GET', `/${VISIBLE}`)).status).toBe(200);
    expect((await call(db, 'GET', `/${MEAL_A}`)).status).toBe(200);
    for (const target of [CROSS, MEAL_B, OTHER]) {
      expect((await call(db, 'GET', `/${target}`)).body).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect((await call(db, 'GET', `/${OTHER}/reminders`)).status).toBe(404);
  });
});

describe('帳單的分校範圍（#1381）—— 寫：範圍外 404 且沒寫進去', () => {
  const writes: Array<[string, string, unknown]> = [
    ['POST', `/${OTHER}/items`, { type: 'adjustment', amount: 100 }],
    ['DELETE', `/${OTHER}/items/${id(50)}`, undefined],
    ['POST', `/${OTHER}/payments`, { amount: 100, method: 'cash' }],
    ['POST', `/${OTHER}/void`, { reason: '測試' }],
    ['POST', `/${OTHER}/reminders`, { method: 'phone' }],
  ];

  it.each(writes)('%s %s', async (method, path, body) => {
    const db = seed();
    const before = {
      items: db.rows('invoice_items').length,
      payments: db.rows('payment_records').length,
      reminders: db.rows('payment_reminders').length,
    };
    const res = await call(db, method, path, { body });
    expect(res.status).toBe(404);
    expect(db.rows('invoice_items')).toHaveLength(before.items);
    expect(db.rows('payment_records')).toHaveLength(before.payments);
    expect(db.rows('payment_reminders')).toHaveLength(before.reminders);
    expect(db.rows('invoices').find((r) => r['id'] === OTHER)?.['voided_at']).toBeNull();
  });

  it('範圍內的單照常寫得進去（對照組）', async () => {
    const db = seed();
    const res = await call(db, 'POST', `/${VISIBLE}/reminders`, { body: { method: 'phone' } });
    expect(res.status).toBe(201);
    expect(db.rows('payment_reminders')).toHaveLength(1);
  });

  it('開單指名範圍外的學生 → 404 STUDENT_NOT_FOUND，沒開出來', async () => {
    const db = seed();
    const res = await call(db, 'POST', '/', { body: { studentId: SB } });
    expect(res.body).toMatchObject({ code: 'STUDENT_NOT_FOUND' });
    expect(db.rows('invoices')).toHaveLength(5);
  });

  it('開單：範圍內學生、明細指名別校報名 → 404 REFERENCE_NOT_FOUND，沒開出來', async () => {
    const db = seed();
    const res = await call(db, 'POST', '/', {
      body: { studentId: SA, items: [{ type: 'tuition', enrollmentId: EB, amount: 1000 }] },
    });
    expect(res.body).toMatchObject({ code: 'REFERENCE_NOT_FOUND' });
    expect(db.rows('invoices')).toHaveLength(5);
  });

  it('範圍內的單加別校報名的明細 → 404，沒加進去', async () => {
    const db = seed();
    const before = db.rows('invoice_items').length;
    const res = await call(db, 'POST', `/${VISIBLE}/items`, {
      body: { type: 'tuition', enrollmentId: EB, amount: 1000 },
    });
    expect(res.body).toMatchObject({ code: 'REFERENCE_NOT_FOUND' });
    expect(db.rows('invoice_items')).toHaveLength(before);
  });

  it('開單：範圍內學生＋本校報名 → 201（對照組）', async () => {
    const db = seed();
    const res = await call(db, 'POST', '/', {
      body: { studentId: SA, items: [{ type: 'tuition', enrollmentId: EA, amount: 1000 }] },
    });
    expect(res.status).toBe(201);
    expect(db.rows('invoices')).toHaveLength(6);
  });
});
