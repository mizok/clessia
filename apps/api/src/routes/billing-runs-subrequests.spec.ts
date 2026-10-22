import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { fakeBillingPool } from '../test-utils/fake-billing-pool';
import { createMultiOrgDb } from '../test-utils/multi-org-db';
import billingRunsRoute from './billing-runs';

/**
 * #1943：整個 run 的 supabase-js 呼叫次數**不隨學生數成長**。
 *
 * Workers 免費方案每個請求 50 個 subrequest，supabase-js 每一句都算一個；原本每位學生 4～5 句寫入，
 * 月結大概十位學生就跑到一半失敗。寫入改走 pool（Hyperdrive 不算 subrequest）之後，
 * 10 位跟 100 位學生打的 supabase-js 次數要一樣。
 */

const ORG = '00000000-0000-0000-0000-0000000000aa';

function seed(n: number) {
  const ids = Array.from({ length: n }, (_, i) => i);
  return createMultiOrgDb({
    enrollments: ids.map((i) => ({
      id: `e${i}`,
      org_id: ORG,
      student_id: `s${i}`,
      class_id: 'class-1',
      status: 'active',
      billing_mode: 'monthly',
      effective_from: '2026-01-01',
      effective_to: null,
      agreed_amount: 3000,
      fee_templates: null,
      classes: { campus_id: 'campus-1' },
    })),
    meal_records: ids.map((i) => ({
      id: `m${i}`,
      org_id: ORG,
      student_id: `s${i}`,
      meal_date: '2026-03-10',
      ordered: true,
      chargeable: true,
      invoice_item_id: null,
      unit_price: 80,
    })),
    invoice_items: [],
    invoices: [],
    organizations: [{ id: ORG, invoice_due_days: 14 }],
  });
}

async function supabaseCallsFor(n: number) {
  const db = seed(n);
  let calls = 0;
  // 只數路由自己打的；替身 pool 寫回 db.client 的那些不算（真的 pool 不經 supabase-js）
  const counted = {
    from: (table: string) => {
      calls += 1;
      return (db.client as { from: (t: string) => unknown }).from(table);
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', counted);
    set('orgId', ORG);
    set('userId', 'u1');
    set('campusScope', null);
    set('auth', {
      pool: fakeBillingPool({ rows: (t) => db.rows(t), client: db.client as never }),
    });
    await next();
  });
  app.route('/', billingRunsRoute as unknown as Hono);
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ periodMonth: '2026-03' }),
  });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { invoicesCreated: number }).invoicesCreated).toBe(n);
  return calls;
}

describe('POST /api/billing-runs —— subrequest 不隨學生數成長（#1943）', () => {
  it('10 位與 100 位學生的 supabase-js 呼叫次數一樣，而且遠低於 50', async () => {
    const ten = await supabaseCallsFor(10);
    const hundred = await supabaseCallsFor(100);
    expect(hundred).toBe(ten);
    expect(hundred).toBeLessThan(20);
  });
});
