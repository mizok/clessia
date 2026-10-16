import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import invoicesRoute from './invoices';

/**
 * #1630：`findScopedInvoice` 讀 DB 失敗要 500，不能折成 404 ——
 * 404 跟「帳單不存在或不在你的範圍」在畫面上一模一樣，壞掉會看起來像正常。
 * 五個呼叫端都走它，所以五條都驗；也驗失敗時沒有寫入任何東西。
 */

const ID = '00000000-0000-0000-0000-000000000001';
const ITEM = '00000000-0000-0000-0000-000000000002';

function failingDb() {
  const writes: string[] = [];
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    const write = (op: string) => () => {
      writes.push(`${op} ${table}`);
      return builder;
    };
    Object.assign(builder, {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      maybeSingle: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
      single: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
      insert: write('insert'),
      update: write('update'),
      delete: write('delete'),
      upsert: write('upsert'),
    });
    return builder;
  };
  return { writes, client: { from } };
}

async function call(method: string, path: string, body?: unknown) {
  const db = failingDb();
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', 'org-1');
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['manage_finance']);
    set('campusScope', null);
    await next();
  });
  app.route('/', invoicesRoute as unknown as Hono);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const res = await app.request(path, {
    method,
    ...(body
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  });
  return { status: res.status, writes: db.writes };
}

describe('findScopedInvoice 讀取失敗 → 500，不是 404（#1630）', () => {
  it.each([
    ['GET /:id', 'GET', `/${ID}`, undefined],
    ['POST /:id/items', 'POST', `/${ID}/items`, { type: 'adjustment', amount: 100 }],
    ['DELETE /:id/items/:itemId', 'DELETE', `/${ID}/items/${ITEM}`, undefined],
    [
      'POST /:id/payments',
      'POST',
      `/${ID}/payments`,
      { amount: 100, method: 'cash', paidAt: '2026-10-16' },
    ],
    ['POST /:id/void', 'POST', `/${ID}/void`, { reason: 'x' }],
  ])('%s', async (_label, method, path, body) => {
    const { status, writes } = await call(method, path, body);
    expect(status).toBe(500);
    expect(writes).toEqual([]);
  });
});
