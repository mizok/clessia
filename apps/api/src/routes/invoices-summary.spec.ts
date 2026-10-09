import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/taipei-date', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/taipei-date')>()),
  getCurrentTaipeiDateString: () => '2026-10-08',
}));

import { createMultiOrgDb, withMaxRows } from '../test-utils/multi-org-db';
import invoicesRoute from './invoices';

/**
 * `GET /api/invoices/summary`（#1314 P1／P2）。加總邏輯在 `lib/invoice-summary.spec.ts`；
 * 這裡守的是撈法：本 org、**撈到底**（`max_rows` 1000 不能把第 1001 張吃掉）。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER = '00000000-0000-0000-0000-00000000000b';
const STUDENT = '00000000-0000-0000-0000-0000000000a1';
const SIBLING = '00000000-0000-0000-0000-0000000000a2';

const invoice = (n: number, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
  org_id: ORG,
  student_id: STUDENT,
  issued_at: '2026-09-01',
  due_date: null,
  voided_at: null,
  invoice_items: [{ amount: '1000' }],
  payment_records: [],
  ...over,
});

async function get(
  invoices: Array<Record<string, unknown>>,
  opts: { maxRows?: number; query?: string } = {},
) {
  const db = createMultiOrgDb({ invoices });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', opts.maxRows ? withMaxRows(db.client, opts.maxRows) : db.client);
    set('orgId', ORG);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', null);
    await next();
  });
  app.route('/', invoicesRoute as unknown as Hono);
  const res = await app.request(`/summary${opts.query ?? ''}`);
  return { status: res.status, body: (await res.json()) as any };
}

describe('GET /api/invoices/summary（#1314 P1／P2）', () => {
  it('只算本 org；numeric 字串照數字加', async () => {
    const { status, body } = await get([
      invoice(1),
      invoice(2, { payment_records: [{ kind: 'payment', amount: '250' }] }),
      invoice(3, { org_id: OTHER }),
    ]);
    expect(status).toBe(200);
    expect(body.byStatus.unpaid).toEqual({ count: 1, outstanding: 1000 });
    expect(body.byStatus.partial).toEqual({ count: 1, outstanding: 750 });
    expect(body.month).toEqual({ month: '2026-10', billed: 0, received: 0 });
  });

  it('作廢單只計張數', async () => {
    const { body } = await get([invoice(1, { voided_at: '2026-09-02T00:00:00Z' })]);
    expect(body.byStatus.void).toEqual({ count: 1 });
    expect(body.byStatus.unpaid).toEqual({ count: 0, outstanding: 0 });
  });

  // 陷阱：PostgREST 撈列只回前 1000 列、不報錯
  it('帳單破千：1001 張都算到', async () => {
    const { body } = await get(
      Array.from({ length: 1001 }, (_, i) => invoice(i + 1)),
      { maxRows: 1000 },
    );
    expect(body.byStatus.unpaid).toEqual({ count: 1001, outstanding: 1001000 });
  });

  it('不帶 studentId：全 org，頂層 outstanding＝未繳清總待收', async () => {
    const { body } = await get([
      invoice(1),
      invoice(2, { student_id: SIBLING, payment_records: [{ kind: 'payment', amount: '250' }] }),
    ]);
    expect(body.byStatus.unpaid.count + body.byStatus.partial.count).toBe(2);
    expect(body.outstanding).toBe(1750);
  });

  it('帶 studentId（#1314 P3）：只算該生，別的學生與別 org 不進', async () => {
    const { status, body } = await get(
      [
        invoice(1, { payment_records: [{ kind: 'payment', amount: '300' }] }),
        invoice(2, { student_id: SIBLING }),
        invoice(3, { org_id: OTHER }),
      ],
      { query: `?studentId=${STUDENT}` },
    );
    expect(status).toBe(200);
    expect(body.byStatus.partial).toEqual({ count: 1, outstanding: 700 });
    expect(body.byStatus.unpaid).toEqual({ count: 0, outstanding: 0 });
    expect(body.outstanding).toBe(700);
  });

  it('studentId 不是 uuid → 400', async () => {
    const { status } = await get([invoice(1)], { query: '?studentId=abc' });
    expect(status).toBe(400);
  });
});
