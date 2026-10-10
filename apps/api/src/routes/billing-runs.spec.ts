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

type Resolve = (table: string, ops: string[]) => { data?: unknown; error?: unknown; count?: number };

function tableFake(resolve: Resolve) {
  const inserts: Array<{ table: string; rows: unknown }> = [];
  const updates: Array<{ table: string; values: unknown }> = [];

  const client = {
    from(table: string) {
      const ops: string[] = [];
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'in', 'gte', 'lte', 'order']) {
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

const ENROLLMENT = '00000000-0000-0000-0000-0000000000e1';

/** 一個月 run 的最小劇本：一筆 active 月繳報名、這個月已經有一列學費（在 `billed` 那張帳單上） */
function monthRun(billed: { voided_at: string | null } | null) {
  return tableFake((table, ops) => {
    if (table === 'enrollments' && ops.includes('is')) return { data: [] }; // 沒計費模式的掃描
    if (table === 'enrollments') {
      return {
        data: [
          {
            id: ENROLLMENT,
            student_id: 's1',
            effective_from: '2026-01-01',
            effective_to: null,
            agreed_amount: 3000,
            fee_templates: null,
          },
        ],
      };
    }
    if (table === 'invoice_items' && ops.includes('insert')) return { data: { id: 'new-item' } };
    if (table === 'invoice_items') {
      // 學費冪等查詢 與 餐費異常掃描 都打這張表；後者帶 eq('type','meal') 且沒有 in()
      if (ops.includes('in')) {
        return { data: billed ? [{ enrollment_id: ENROLLMENT, invoices: billed }] : [] };
      }
      return { data: [] };
    }
    if (table === 'invoices') return { data: { id: 'new-invoice' } };
    if (table === 'organizations') return { data: { invoice_due_days: 14 } };
    return { data: [] };
  });
}

async function runMonth(fake: ReturnType<typeof tableFake>) {
  const res = await appWith(fake.client).request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ periodMonth: '2026-03' }),
  });
  await new Promise((r) => setTimeout(r, 0));
  return (await res.json()) as { invoicesCreated: number; tuitionItems: number };
}

describe('POST /api/billing-runs —— 學費冪等認得作廢單（#898）', () => {
  // 對照組：證明替身有鑑別力 —— 開過的就不再開
  it('這個月已經開在一張有效帳單上 → 不重開', async () => {
    const body = await runMonth(monthRun({ voided_at: null }));

    expect(body.tuitionItems).toBe(0);
    expect(body.invoicesCreated).toBe(0);
  });

  it('這個月那一列在一張作廢單上 → 當成沒開過，重開', async () => {
    const body = await runMonth(monthRun({ voided_at: '2026-03-10T00:00:00Z' }));

    expect(body.tuitionItems).toBe(1);
    expect(body.invoicesCreated).toBe(1);
  });
});

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
      if (table === 'meal_records') return { data: [{ invoice_item_id: 'live-meal', unit_price: 400 }] };
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
