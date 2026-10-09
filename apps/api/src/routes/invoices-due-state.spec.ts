import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/taipei-date', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/taipei-date')>()),
  getCurrentTaipeiDateString: () => '2026-10-08',
}));

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import invoicesRoute from './invoices';

/**
 * `GET /api/invoices?dueState=…`（#1314 P1）：未繳清的互斥章，判準是 `dueStateOn`。
 * 彙總的分桶在 `lib/invoice-summary.spec.ts`；這裡守列表的篩選與彙總用的是同一條分界。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const invoice = (n: number, dueDate: string | null, paid = 0, voided = false) => ({
  id: id(n),
  org_id: ORG,
  student_id: id(900),
  issued_at: '2026-10-01',
  due_date: dueDate,
  voided_at: voided ? '2026-10-02T00:00:00Z' : null,
  note: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  students: { name: '甲' },
  invoice_items: [{ id: id(n * 10), type: 'tuition', amount: '1000' }],
  payment_records: paid ? [{ id: id(n * 10 + 1), kind: 'payment', amount: String(paid) }] : [],
});

const OVERDUE = id(1);
const SOON_TODAY = id(2);
const SOON_DAY7 = id(3);
const LATER = id(4);
const NO_DUE = id(5);

function seed() {
  return createMultiOrgDb({
    invoices: [
      invoice(1, '2026-10-07'),
      invoice(2, '2026-10-08', 400),
      invoice(3, '2026-10-15'),
      invoice(4, '2026-10-16'),
      invoice(5, null),
      invoice(6, '2026-10-09', 1000), // 繳清：不在任何一章
      invoice(7, '2026-10-09', 0, true), // 作廢：不在任何一章
    ],
  });
}

async function get(path: string) {
  const db = seed();
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
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as any };
}

const ids = (body: any) => body.data.map((r: { id: string }) => r.id).sort();

describe('GET /api/invoices?dueState（#1314 P1）', () => {
  it('三章互斥、聯集＝未繳清全體；沒到期日落 notDue', async () => {
    const overdue = await get('/?dueState=overdue');
    const soon = await get('/?dueState=dueSoon');
    const later = await get('/?dueState=notDue');
    expect(ids(overdue.body)).toEqual([OVERDUE]);
    expect(ids(soon.body)).toEqual([SOON_TODAY, SOON_DAY7]);
    expect(ids(later.body)).toEqual([LATER, NO_DUE]);
    const all = await get('/?outstanding=true');
    expect([...ids(overdue.body), ...ids(soon.body), ...ids(later.body)].sort()).toEqual(
      ids(all.body),
    );
    expect(soon.body.meta.total).toBe(2);
  });

  it('跟彙總同一條分界：各章張數＝summary 的桶', async () => {
    const { body: summary } = await get('/summary');
    for (const state of ['overdue', 'dueSoon', 'notDue'] as const) {
      const { body } = await get(`/?dueState=${state}`);
      expect(body.meta.total).toBe(summary[state].count);
    }
    expect(summary.dueSoon.days).toBe(7);
  });

  it('與 status 並用＝AND', async () => {
    const { body } = await get('/?dueState=dueSoon&status=partial');
    expect(ids(body)).toEqual([SOON_TODAY]);
  });

  it('不認得的值 → 400，不靜靜篩成空的', async () => {
    expect((await get('/?dueState=soon')).status).toBe(400);
  });
});
