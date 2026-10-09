import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import invoicesRoute from './invoices';

/**
 * `POST /api/invoices/reminders/batch`（#1314 P5，逾期章「全部提醒」）＋單筆催繳的 insert error（順手修）。
 * 整批驗、整批拒：任一張不存在／別 org／範圍外 → 404，任一張作廢 → 409，都**一列都不寫**。
 * 帳單列直接帶 `INVOICE_SCOPE_EMBED` 的 alias 欄位（替身不解析 select；select 字串本機實打）。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER = '00000000-0000-0000-0000-00000000000b';
const CA = '00000000-0000-0000-0000-0000000000ca';
const CB = '00000000-0000-0000-0000-0000000000cb';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const A1 = id(1);
const A2 = id(2);
const B1 = id(3); // 只在 B 校的學生
const VOID = id(4);
const FOREIGN = id(5); // 別 org

const invoice = (invoiceId: string, campus: string, over: Record<string, unknown> = {}) => ({
  id: invoiceId,
  org_id: ORG,
  voided_at: null,
  scope_student: { enrollments: [{ classes: { campus_id: campus } }] },
  scope_items: [{ enrollments: { classes: { campus_id: campus } } }],
  ...over,
});

function seed() {
  return createMultiOrgDb({
    invoices: [
      invoice(A1, CA),
      invoice(A2, CA),
      invoice(B1, CB),
      invoice(VOID, CA, { voided_at: '2026-10-01T00:00:00Z' }),
      invoice(FOREIGN, CA, { org_id: OTHER }),
    ],
    payment_reminders: [],
    audit_logs: [],
    profiles: [],
  });
}

type Db = ReturnType<typeof seed>;

async function post(
  db: Db,
  path: string,
  body: unknown,
  opts: { scope?: readonly string[] | null; client?: unknown } = {},
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', opts.client ?? db.client);
    set('orgId', ORG);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['manage_finance']);
    set('campusScope', opts.scope === undefined ? null : opts.scope);
    await next();
  });
  app.route('/', invoicesRoute as unknown as Hono);
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  // 稽核是 fire-and-forget（profile 查詢＋insert 兩層 await）
  await new Promise((r) => setTimeout(r, 0));
  return { status: res.status, body: (await res.json()) as any };
}

/** 讓某張表的 insert 失敗，其他照真的替身走 */
function failingInsert(db: Db, table: string) {
  const real = db.client as any;
  return {
    from(name: string) {
      const builder = real.from(name);
      if (name !== table) return builder;
      return new Proxy(builder, {
        get(target, prop) {
          if (prop !== 'insert') return Reflect.get(target, prop);
          return () => Promise.resolve({ data: null, error: { message: 'boom' } });
        },
      });
    },
  };
}

const BATCH = '/reminders/batch';

describe('POST /api/invoices/reminders/batch（#1314 P5）', () => {
  it('全在範圍：201、每張一列催繳、每張一筆稽核（batch: true）；重複 id 只算一次', async () => {
    const db = seed();
    const { status, body } = await post(db, BATCH, {
      invoiceIds: [A1, A2, A1],
      method: 'line',
      note: '十月逾期',
    });
    expect(status).toBe(201);
    expect(body).toEqual({ count: 2 });
    const rows = db.rows('payment_reminders');
    expect(rows.map((r) => r['invoice_id']).sort()).toEqual([A1, A2]);
    expect(rows[0]).toMatchObject({ method: 'line', note: '十月逾期', created_by: 'admin-a' });
    const audits = db.rows('audit_logs');
    expect(audits.map((a) => a['resource_id']).sort()).toEqual([A1, A2]);
    expect(audits[0]).toMatchObject({
      org_id: ORG,
      action: 'invoice.remind',
      details: { method: 'line', batch: true },
    });
  });

  it('混一張別 org 的 → 整批 404，一列都不寫', async () => {
    const db = seed();
    const { status, body } = await post(db, BATCH, { invoiceIds: [A1, FOREIGN], method: 'phone' });
    expect(status).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
    expect(db.rows('payment_reminders')).toEqual([]);
    expect(db.rows('audit_logs')).toEqual([]);
  });

  it('混一張不存在的 → 整批 404', async () => {
    const db = seed();
    expect((await post(db, BATCH, { invoiceIds: [A1, id(99)], method: 'line' })).status).toBe(404);
    expect(db.rows('payment_reminders')).toEqual([]);
  });

  it('受限 A 校混一張 B 校的 → 整批 404（範圍外＝不存在）；不受限則照寫', async () => {
    const db = seed();
    const { status } = await post(
      db,
      BATCH,
      { invoiceIds: [A1, B1], method: 'line' },
      { scope: [CA] },
    );
    expect(status).toBe(404);
    expect(db.rows('payment_reminders')).toEqual([]);
    const open = await post(seed(), BATCH, { invoiceIds: [A1, B1], method: 'line' });
    expect(open.status).toBe(201);
  });

  it('混一張作廢的 → 整批 409，一列都不寫', async () => {
    const db = seed();
    const { status, body } = await post(db, BATCH, { invoiceIds: [A1, VOID], method: 'line' });
    expect(status).toBe(409);
    expect(body.code).toBe('INVOICE_VOIDED');
    expect(db.rows('payment_reminders')).toEqual([]);
  });

  it('別 org 的作廢單：先拿到 404 不是 409（存在檢查在前，不透露存在）', async () => {
    const db = createMultiOrgDb({
      invoices: [invoice(FOREIGN, CA, { org_id: OTHER, voided_at: '2026-10-01T00:00:00Z' })],
    });
    expect((await post(db, BATCH, { invoiceIds: [FOREIGN], method: 'line' })).status).toBe(404);
  });

  it('空陣列、超過 200 張、method 不在列舉 → 400', async () => {
    const db = seed();
    expect((await post(db, BATCH, { invoiceIds: [], method: 'line' })).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => id(1000 + i));
    expect((await post(db, BATCH, { invoiceIds: many, method: 'line' })).status).toBe(400);
    expect((await post(db, BATCH, { invoiceIds: [A1], method: 'email' })).status).toBe(400);
  });

  it('insert 失敗 → 500，不寫稽核', async () => {
    const db = seed();
    const { status } = await post(
      db,
      BATCH,
      { invoiceIds: [A1], method: 'line' },
      { client: failingInsert(db, 'payment_reminders') },
    );
    expect(status).toBe(500);
    expect(db.rows('audit_logs')).toEqual([]);
  });
});

describe('POST /api/invoices/{id}/reminders —— insert 失敗（P5 順手修）', () => {
  it('寫入失敗 → 500，不寫稽核（原本照回 201）', async () => {
    const db = seed();
    const { status } = await post(
      db,
      `/${A1}/reminders`,
      { method: 'line' },
      { client: failingInsert(db, 'payment_reminders') },
    );
    expect(status).toBe(500);
    expect(db.rows('audit_logs')).toEqual([]);
  });
});
