import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import invoicesRoute from './invoices';
import mealsRoute from './meals';

/**
 * **body 指名的外部 id 要驗屬於本 org（c1，#966 B4）。**
 *
 * B1 修的是「path 的 id 定位寫入」；這裡是另一個載體 —— id 在 body 裡，被拿去**寫進新列**。
 * 最嚴重的是 `POST /api/meals/batch`：`upsert(onConflict: student_id,meal_date)` 的衝突鍵
 * 不含 `org_id`，所以 org A 拿 org B 的學生 id 打進來，**會把 B 那天的訂餐列整列覆寫、
 * 連 `org_id` 都改成 A** —— 而「已結算的不動」那道鎖只查 A 自己的列，B 的已結算列擋不住。
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const STUDENT_A = id(101);
const STUDENT_B = id(102);
const ENROLLMENT_A = id(201);
const ENROLLMENT_B = id(202);
const DATE = '2026-09-30';

function seed() {
  return createMultiOrgDb({
    organizations: [
      { id: ORG_A, meal_default_price: 80, invoice_due_days: 14 },
      { id: ORG_B, meal_default_price: 90, invoice_due_days: 14 },
    ],
    students: [
      { id: STUDENT_A, org_id: ORG_A, name: '甲' },
      { id: STUDENT_B, org_id: ORG_B, name: '乙' },
    ],
    enrollments: [
      { id: ENROLLMENT_A, org_id: ORG_A, student_id: STUDENT_A },
      { id: ENROLLMENT_B, org_id: ORG_B, student_id: STUDENT_B },
    ],
    // B 那天已結算的一列 —— 被覆寫的話帳單金額就對不上了
    meal_records: [
      {
        id: id(301),
        org_id: ORG_B,
        student_id: STUDENT_B,
        meal_date: DATE,
        ordered: true,
        chargeable: true,
        unit_price: 90,
        invoice_item_id: id(999),
      },
    ],
    invoices: [],
  });
}

function post(route: unknown, db: ReturnType<typeof seed>, path: string, body: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG_A);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', null);
    await next();
  });
  app.route('/', route as Hono);
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/meals/batch —— 學生要屬於本 org', () => {
  it('別 org 的學生 → 404，對方那天的（已結算）訂餐列不被覆寫，也沒有新列', async () => {
    const db = seed();
    const before = db.rows('meal_records');

    const res = await post(mealsRoute, db, '/batch', {
      date: DATE,
      rows: [
        { studentId: STUDENT_A, ordered: true },
        { studentId: STUDENT_B, ordered: false, unitPrice: 0 },
      ],
    });

    expect(res.status).toBe(404);
    // 整批拒絕：連 A 自己那一筆也不寫 —— 部分成功會讓行政以為整批都存了
    expect(db.rows('meal_records')).toEqual(before);
  });

  it('同 org 的學生 → 200，真的寫進去', async () => {
    const db = seed();

    const res = await post(mealsRoute, db, '/batch', {
      date: DATE,
      rows: [{ studentId: STUDENT_A, ordered: true }],
    });

    expect(res.status).toBe(200);
    expect(db.rows('meal_records').find((r) => r['student_id'] === STUDENT_A)).toMatchObject({
      org_id: ORG_A,
      meal_date: DATE,
      ordered: true,
      unit_price: 80,
    });
  });
});

describe('POST /api/invoices —— 學生與明細參照要屬於本 org', () => {
  it('別 org 的學生 → 404，沒有開出帳單', async () => {
    const db = seed();

    const res = await post(invoicesRoute, db, '/', { studentId: STUDENT_B });

    expect(res.status).toBe(404);
    expect(db.rows('invoices')).toEqual([]);
  });

  it('明細指名別 org 的報名 → 404，沒有開出帳單（也沒有留下空殼）', async () => {
    const db = seed();

    const res = await post(invoicesRoute, db, '/', {
      studentId: STUDENT_A,
      items: [{ type: 'tuition', enrollmentId: ENROLLMENT_B, amount: 1000 }],
    });

    expect(res.status).toBe(404);
    expect(db.rows('invoices')).toEqual([]);
    expect(db.rows('invoice_items')).toEqual([]);
  });

  it('同 org 的學生與報名 → 201，真的開出來', async () => {
    const db = seed();

    const res = await post(invoicesRoute, db, '/', {
      studentId: STUDENT_A,
      items: [{ type: 'tuition', enrollmentId: ENROLLMENT_A, amount: 1000 }],
    });

    expect(res.status).toBe(201);
    expect(db.rows('invoices')).toEqual([
      expect.objectContaining({ org_id: ORG_A, student_id: STUDENT_A }),
    ]);
    expect(db.rows('invoice_items')).toEqual([
      expect.objectContaining({ enrollment_id: ENROLLMENT_A, amount: 1000 }),
    ]);
  });
});
