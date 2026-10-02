import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import invoicesRoute from './invoices';

/**
 * **退費不得超過這張帳單已收的淨額（#1034，計畫席裁決 C）。**
 *
 * 收 1,000、退 1,500 會讓帳單淨額變 −500 —— 帳務上沒有意義（輸入錯誤，或跨帳單的補償，
 * 後者該開新帳單），而它在家長端被算成「尚欠 1,500」。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const INVOICE = '00000000-0000-0000-0000-000000000101';

function seed(payments: Array<{ kind: 'payment' | 'refund'; amount: number }>) {
  return createMultiOrgDb({
    invoices: [{ id: INVOICE, org_id: ORG, student_id: 'stu-1', voided_at: null }],
    payment_records: payments.map((p, i) => ({
      id: `pay-${i}`,
      org_id: ORG,
      invoice_id: INVOICE,
      ...p,
    })),
  });
}

function refund(db: ReturnType<typeof seed>, amount: number) {
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
  app.route('/', invoicesRoute as unknown as Hono);
  return app.request(`/${INVOICE}/payments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'refund', amount, method: 'cash' }),
  });
}

const refundsIn = (db: ReturnType<typeof seed>) =>
  db.rows('payment_records').filter((r) => r['kind'] === 'refund');

describe('POST /api/invoices/:id/payments —— 退費上限 = 已收淨額', () => {
  it('收 1,000、退 1,500 → 409 REFUND_EXCEEDS_PAID，訊息說得出已收多少、最多可退多少，沒有寫入', async () => {
    const db = seed([{ kind: 'payment', amount: 1000 }]);

    const res = await refund(db, 1500);

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('REFUND_EXCEEDS_PAID');
    expect(body.error).toContain('1,000');
    expect(refundsIn(db)).toEqual([]);
  });

  it('上限算的是淨額：收 1,000、已退 400 → 再退 700 擋、退 600 放', async () => {
    const db = seed([
      { kind: 'payment', amount: 1000 },
      { kind: 'refund', amount: 400 },
    ]);

    expect((await refund(db, 700)).status).toBe(409);
    expect((await refund(db, 600)).status).not.toBe(409);
    expect(refundsIn(db).map((r) => r['amount'])).toEqual([400, 600]);
  });

  it('剛好退到 0 可以（全額退費是正常操作）', async () => {
    const db = seed([{ kind: 'payment', amount: 1000 }]);

    expect((await refund(db, 1000)).status).not.toBe(409);
    expect(refundsIn(db).map((r) => r['amount'])).toEqual([1000]);
  });
});
