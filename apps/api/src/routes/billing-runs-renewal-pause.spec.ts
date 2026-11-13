import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { fakeBillingPool } from '../test-utils/fake-billing-pool';
import { createMultiOrgDb } from '../test-utils/multi-org-db';
import billingRunsRoute from './billing-runs';

/**
 * #1122：學生有處理中的續課異動（pending）＝暫停自動開單。gate Q3 (a)：**只擋期 run 的學費**，
 * 月 run（月繳學費、餐費）照開；被擋的列在 `pausedStudents`，結案或撤回後重跑會補開。
 */

const ORG = '00000000-0000-0000-0000-0000000000aa';
const PERIOD = '00000000-0000-0000-0000-0000000000f1';

const enrollment = (student: string, billing_mode: 'monthly' | 'period') => ({
  id: `e-${student}-${billing_mode}`,
  org_id: ORG,
  student_id: student,
  class_id: 'class-1',
  status: 'active',
  billing_mode,
  effective_from: '2026-01-01',
  effective_to: null,
  agreed_amount: 3000,
  fee_templates: null,
  classes: { campus_id: 'campus-1' },
});

function seed(renewals: Array<Record<string, unknown>>) {
  return createMultiOrgDb({
    enrollments: ['s-paused', 's-normal'].flatMap((s) => [
      enrollment(s, 'period'),
      enrollment(s, 'monthly'),
    ]),
    meal_records: [],
    invoice_items: [],
    invoices: [],
    renewal_requests: renewals,
    organizations: [{ id: ORG, invoice_due_days: 14 }],
    billing_periods: [
      { id: PERIOD, org_id: ORG, start_date: '2026-02-01', end_date: '2026-07-31', name: '115 春' },
    ],
  });
}

async function runWith(db: ReturnType<typeof seed>, body: Record<string, unknown>) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'u1');
    set('campusScope', null);
    set('auth', { pool: fakeBillingPool({ rows: (t) => db.rows(t), client: db.client as never }) });
    await next();
  });
  app.route('/', billingRunsRoute as unknown as Hono);
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    invoicesCreated: number;
    pausedStudents: Array<{ studentId: string; studentName: string | null }>;
  };
  const billed = db
    .rows('invoices')
    .map((i) => i['student_id'])
    .sort();
  return { ...json, billed };
}

const pending = { id: 'rr-1', org_id: ORG, student_id: 's-paused', status: 'pending' };

describe('POST /api/billing-runs —— 續課異動暫停（#1122）', () => {
  it('期 run：處理中的那位整位略過、列在 pausedStudents；別人照開', async () => {
    const r = await runWith(seed([pending]), { billingPeriodId: PERIOD });
    expect(r.billed).toEqual(['s-normal']);
    expect(r.invoicesCreated).toBe(1);
    expect(r.pausedStudents).toEqual([{ studentId: 's-paused', studentName: null }]);
  });

  it('月 run：不受影響（Q3 (a)），兩位都開', async () => {
    const r = await runWith(seed([pending]), { periodMonth: '2026-03' });
    expect(r.billed).toEqual(['s-normal', 's-paused']);
    expect(r.pausedStudents).toEqual([]);
  });

  it('已結案、已撤回、別的 org 的申請不擋', async () => {
    const r = await runWith(
      seed([
        { ...pending, id: 'rr-2', status: 'resolved' },
        { ...pending, id: 'rr-3', status: 'withdrawn' },
        { ...pending, id: 'rr-4', org_id: 'org-other' },
      ]),
      { billingPeriodId: PERIOD },
    );
    expect(r.billed).toEqual(['s-normal', 's-paused']);
    expect(r.pausedStudents).toEqual([]);
  });
});
