import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import billingRunsRoute from './billing-runs';

/**
 * #1393：受限的管理員跑帳務作業，只開自己分校那一份；異常也只看、只修範圍內的。
 *
 * 判準與 `lib/invoice-campus-scope.ts` 同一條：學費挑班在範圍內的報名，餐費（沒有分校）
 * 挑任一報名在範圍內的學生。替身真的照 `classes.campus_id` 過濾，所以條件沒下就會紅。
 */

const ORG = '00000000-0000-0000-0000-0000000000aa';
const C1 = 'campus-1';
const C2 = 'campus-2';

const enrollment = (
  id: string,
  studentId: string,
  campusId: string,
  billingMode: string | null,
) => ({
  id,
  org_id: ORG,
  student_id: studentId,
  class_id: `class-${campusId}`,
  status: 'active',
  billing_mode: billingMode,
  effective_from: '2026-01-01',
  effective_to: null,
  agreed_amount: 3000,
  fee_templates: null,
  classes: { campus_id: campusId },
});

const meal = (id: string, studentId: string) => ({
  id,
  org_id: ORG,
  student_id: studentId,
  meal_date: '2026-03-10',
  ordered: true,
  chargeable: true,
  invoice_item_id: null,
  unit_price: 80,
});

/** 一張金額對不上蓋章總額的餐費明細，帳單掛在只讀 `campusId` 的學生身上 */
const mealItem = (id: string, campusId: string) => ({
  id,
  type: 'meal',
  amount: 0,
  invoices: {
    org_id: ORG,
    voided_at: null,
    scope_student: { enrollments: [{ classes: { campus_id: campusId } }] },
    scope_items: [{ enrollments: null }],
  },
});

function seed() {
  return createMultiOrgDb({
    enrollments: [
      enrollment('e1', 's1', C1, 'monthly'),
      enrollment('e2', 's2', C2, 'monthly'),
      // s3 跨校：只有 C1 那筆學費該被 C1 的人開
      enrollment('e3', 's3', C1, 'monthly'),
      enrollment('e4', 's3', C2, 'monthly'),
      enrollment('e5', 's5', C1, null),
      enrollment('e6', 's6', C2, null),
    ],
    // s4 沒有任何報名 —— 推不出分校，受限者不開
    meal_records: [
      meal('m1', 's1'),
      meal('m2', 's2'),
      meal('m4', 's4'),
      { ...meal('stamped-1', 'x'), meal_date: '2026-02-01', invoice_item_id: 'mi-c1' },
      { ...meal('stamped-2', 'y'), meal_date: '2026-02-01', invoice_item_id: 'mi-c2' },
    ],
    invoice_items: [mealItem('mi-c1', C1), mealItem('mi-c2', C2)],
    invoices: [],
    organizations: [{ id: ORG, invoice_due_days: 14 }],
  });
}

function appWith(db: ReturnType<typeof seed>, campusScope: string[] | null) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'u1');
    set('campusScope', campusScope);
    await next();
  });
  app.route('/', billingRunsRoute as unknown as Hono);
  return app;
}

async function run(db: ReturnType<typeof seed>, scope: string[] | null) {
  const res = await appWith(db, scope).request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ periodMonth: '2026-03' }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    invoicesCreated: number;
    anomalies: Array<{ invoiceItemId: string }>;
    enrollmentsWithoutBillingMode: Array<{ id: string }>;
  };
}

const tuitionOf = (db: ReturnType<typeof seed>) =>
  db
    .rows('invoice_items')
    .filter((row) => row['type'] === 'tuition')
    .map((row) => row['enrollment_id'])
    .sort();

describe('POST /api/billing-runs —— 分校範圍（#1393）', () => {
  it('受限 C1：只開 C1 的報名與 C1 學生的餐費', async () => {
    const db = seed();
    const body = await run(db, [C1]);

    expect(
      db
        .rows('invoices')
        .map((row) => row['student_id'])
        .sort(),
    ).toEqual(['s1', 's3']);
    expect(body.invoicesCreated).toBe(2);
    expect(tuitionOf(db)).toEqual(['e1', 'e3']);
    // 只有 s1 的餐被蓋章；s2（C2）、s4（無報名）原封不動
    const stamped = db
      .rows('meal_records')
      .filter((row) => row['meal_date'] === '2026-03-10' && row['invoice_item_id'] !== null)
      .map((row) => row['id']);
    expect(stamped).toEqual(['m1']);
    expect(body.anomalies.map((a) => a.invoiceItemId)).toEqual(['mi-c1']);
    expect(body.enrollmentsWithoutBillingMode.map((e) => e.id)).toEqual(['e5']);
  });

  it('一個分校都沒有：一張都不開', async () => {
    const db = seed();
    const body = await run(db, []);

    expect(body.invoicesCreated).toBe(0);
    expect(db.rows('invoices')).toEqual([]);
    expect(body.anomalies).toEqual([]);
    expect(body.enrollmentsWithoutBillingMode).toEqual([]);
  });

  // 對照組：不受限時行為不變 —— 證明上面的少開是範圍造成的
  it('不受限：全 org 照開', async () => {
    const db = seed();
    const body = await run(db, null);

    expect(
      db
        .rows('invoices')
        .map((row) => row['student_id'])
        .sort(),
    ).toEqual(['s1', 's2', 's3', 's4']);
    expect(tuitionOf(db)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(body.enrollmentsWithoutBillingMode.map((e) => e.id).sort()).toEqual(['e5', 'e6']);
  });
});

describe('GET /anomalies、POST /repair —— 分校範圍（#1393）', () => {
  it('受限 C1：只看得到 C1 帳單的異常', async () => {
    const res = await appWith(seed(), [C1]).request('/anomalies');
    const body = (await res.json()) as {
      data: Array<{ invoiceItemId: string }>;
      enrollmentsWithoutBillingMode: Array<{ id: string }>;
    };

    expect(body.data.map((a) => a.invoiceItemId)).toEqual(['mi-c1']);
    expect(body.enrollmentsWithoutBillingMode.map((e) => e.id)).toEqual(['e5']);
  });

  it('受限 C1：repair 只改 C1 的明細，C2 的不動', async () => {
    const db = seed();
    const res = await appWith(db, [C1]).request('/repair', { method: 'POST' });
    const body = (await res.json()) as { repaired: number };

    expect(body.repaired).toBe(1);
    const amount = (id: string) =>
      db.rows('invoice_items').find((row) => row['id'] === id)?.['amount'];
    expect(amount('mi-c1')).toBe(80);
    expect(amount('mi-c2')).toBe(0);
  });

  it('不受限：兩筆都看得到', async () => {
    const res = await appWith(seed(), null).request('/anomalies');
    const body = (await res.json()) as { data: Array<{ invoiceItemId: string }> };

    expect(body.data.map((a) => a.invoiceItemId).sort()).toEqual(['mi-c1', 'mi-c2']);
  });
});
