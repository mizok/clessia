import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import billingRunsRoute from './billing-runs';

/**
 * #898：作廢 = 這張帳單的收費項回到未開帳（計畫席裁決 B）。
 *
 * 帳務作業的兩種冪等（見 `lib/billing-run.ts` 檔頭）都要認得作廢單：
 * - 學費查衍生列 —— 作廢單上的學費列**不算開過**，否則那個月永遠開不出來
 * - 餐費靠蓋章 —— 作廢端點解章；解完之後作廢單上的餐費 item 會「金額對不上蓋章」，
 *   **異常掃描要跳過它**，否則 repair 會去改一張作廢單（DB trigger 會擋，
 *   結果就是每次 run 都回報一筆修不掉的異常）
 *
 * 替身按表回資料，**不模擬任何過濾**，所以作廢單要在應用層被篩掉才會綠。
 */

type Resolve = (
  table: string,
  ops: string[],
) => { data?: unknown; error?: unknown; count?: number };

function tableFake(resolve: Resolve) {
  const inserts: Array<{ table: string; rows: unknown }> = [];
  const updates: Array<{ table: string; values: unknown }> = [];

  const client = {
    from(table: string) {
      const ops: string[] = [];
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'in', 'gte', 'lte', 'order', 'range']) {
        query[method] = () => {
          ops.push(method);
          return query;
        };
      }
      query['insert'] = (rows: unknown) => {
        ops.push('insert');
        inserts.push({ table, rows });
        return query;
      };
      query['update'] = (values: unknown) => {
        ops.push('update');
        updates.push({ table, values });
        return query;
      };
      const settle = () => Promise.resolve({ data: null, error: null, ...resolve(table, ops) });
      query['maybeSingle'] = settle;
      query['single'] = settle;
      query['then'] = (ok: (v: unknown) => unknown, ng: (e: unknown) => unknown) =>
        settle().then(ok, ng);
      return query;
    },
  };

  return { client, inserts, updates };
}

function appWith(supabase: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', supabase);
    set('orgId', '00000000-0000-0000-0000-0000000000aa');
    set('userId', 'u1');
    set('campusScope', null);
    await next();
  });
  app.route('/', billingRunsRoute as unknown as Hono);
  return app;
}

// #898 的學費那一半（作廢單上的學費不算開過）：#1943 起開帳只走 pg（學費冪等是 SQL），
// 替身驗不到 SQL 語意，改由 contract/billing-run-scale.contract.ts 對真 Postgres 守（作廢後重開剛好那一張）。

describe('餐費異常掃描跳過作廢單（#898）', () => {
  /** 兩個餐費 item 都「金額對不上蓋章」—— 一個在有效帳單上、一個在作廢單上（章已解） */
  function mismatched() {
    return tableFake((table) => {
      if (table === 'invoice_items') {
        return {
          data: [
            { id: 'live-meal', amount: 500, invoices: { org_id: 'o', voided_at: null } },
            {
              id: 'void-meal',
              amount: 900,
              invoices: { org_id: 'o', voided_at: '2026-03-10T00:00:00Z' },
            },
          ],
        };
      }
      if (table === 'meal_records')
        return { data: [{ invoice_item_id: 'live-meal', unit_price: 400 }] };
      return { data: [] };
    });
  }

  it('GET /anomalies 只回有效帳單上的那一筆', async () => {
    const res = await appWith(mismatched().client).request('/anomalies');
    const body = (await res.json()) as { data: Array<{ invoiceItemId: string }> };

    expect(body.data.map((a) => a.invoiceItemId)).toEqual(['live-meal']);
  });

  it('POST /repair 不去改作廢單的 item', async () => {
    const fake = mismatched();
    await appWith(fake.client).request('/repair', { method: 'POST' });

    const itemUpdates = fake.updates.filter((u) => u.table === 'invoice_items');
    expect(itemUpdates).toEqual([{ table: 'invoice_items', values: { amount: 400 } }]);
  });
});
