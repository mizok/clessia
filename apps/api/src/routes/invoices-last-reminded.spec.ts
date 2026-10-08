import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { INVOICE_SELECT } from '../lib/invoice-query';
import { createMultiOrgDb } from '../test-utils/multi-org-db';
import invoicesRoute from './invoices';

/**
 * `GET /api/invoices` 每列帶 `lastRemindedAt`（#1314 P3）：`payment_reminders` 最近一筆的
 * `created_at`，沒催過是 null。兩條分頁路徑都帶；家長端共用的 `INVOICE_SELECT` 不帶。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const invoice = (n: number, reminders: string[], voided = false) => ({
  id: id(n),
  org_id: ORG,
  student_id: id(900),
  issued_at: '2026-10-01',
  due_date: null,
  voided_at: voided ? '2026-10-02T00:00:00Z' : null,
  note: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  students: { name: '甲' },
  invoice_items: [{ id: id(n * 10), type: 'tuition', amount: '1000' }],
  payment_records: [],
  payment_reminders: reminders.map((created_at) => ({ created_at })),
});

async function get(path: string) {
  const db = createMultiOrgDb({
    invoices: [
      // 較新的那筆刻意不放第一個，也不放最後一個
      invoice(1, [
        '2026-10-03T02:00:00+00:00',
        '2026-10-07T09:30:00+00:00',
        '2026-10-05T01:00:00+00:00',
      ]),
      invoice(2, []),
      invoice(3, ['2026-10-04T00:00:00+00:00'], true),
    ],
  });
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
  return (await res.json()) as { data: Array<{ id: string; lastRemindedAt: string | null }> };
}

const byId = (body: Awaited<ReturnType<typeof get>>) =>
  Object.fromEntries(body.data.map((r) => [r.id, r.lastRemindedAt]));

describe('GET /api/invoices —— lastRemindedAt（#1314 P3）', () => {
  const expected = {
    [id(1)]: '2026-10-07T09:30:00+00:00',
    [id(2)]: null,
    [id(3)]: '2026-10-04T00:00:00+00:00', // 作廢單照帶
  };

  it('DB 分頁路徑：取最近一筆、沒催過是 null', async () => {
    expect(byId(await get('/'))).toEqual(expected);
  });

  it('推導路徑（status 篩選）也帶', async () => {
    expect(byId(await get('/?status=unpaid'))).toEqual({ [id(1)]: expected[id(1)], [id(2)]: null });
  });

  it('家長端共用的 INVOICE_SELECT 不帶催繳', () => {
    expect(INVOICE_SELECT).not.toContain('payment_reminders');
  });
});
