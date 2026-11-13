import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { NothingToBill, PausedForRenewal, billStudent } from '../lib/billing-run-write';
import { fakeBillingPool } from '../test-utils/fake-billing-pool';
import { createMultiOrgDb } from '../test-utils/multi-org-db';
import billingRunsRoute from './billing-runs';

/**
 * #1122：學生有處理中的續課異動（pending）＝暫停自動開單。gate Q3 (a)：**只擋期 run 的學費**，
 * 月 run（月繳學費、餐費）照開；被擋的列在 `pausedStudents`，結案或撤回後重跑會補開。
 */

const ORG = '00000000-0000-0000-0000-0000000000aa';
const PERIOD = '00000000-0000-0000-0000-0000000000f1';

// id 以學生順序開頭：候選依 id 排序，**被擋的那位排在前面** —— 擋了之後 break 的話後面的人會漏開（C6）
const ORDER: Record<string, string> = { 's-paused': '1', 's-normal': '2' };
const enrollment = (student: string, billing_mode: 'monthly' | 'period') => ({
  id: `e${ORDER[student]}-${student}-${billing_mode}`,
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

function seed(
  renewals: Array<Record<string, unknown>>,
  invoiceItems: Array<Record<string, unknown>> = [],
) {
  return createMultiOrgDb({
    enrollments: ['s-paused', 's-normal'].flatMap((s) => [
      enrollment(s, 'period'),
      enrollment(s, 'monthly'),
    ]),
    meal_records: [],
    invoice_items: invoiceItems,
    invoices: [],
    renewal_requests: renewals,
    audit_logs: [],
    profiles: [],
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
  const background: Promise<unknown>[] = [];
  const res = await app.request(
    '/',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    {},
    {
      waitUntil: (p: Promise<unknown>) => background.push(p),
      passThroughOnException: () => undefined,
    } as never,
  );
  await Promise.all(background); // 稽核在背景寫
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

  it('稽核 details 帶略過的人數（C8）', async () => {
    const db = seed([pending]);
    await runWith(db, { billingPeriodId: PERIOD });
    const audit = db.rows('audit_logs').find((a) => a['resource_type'] === 'billing_run');
    expect((audit?.['details'] as Record<string, unknown>)['pausedStudents']).toBe(1);
  });

  it('學費這期已經開過的學生有 pending：不報暫停，算沒有可開（擋點在「已開過濾」之後，C5）', async () => {
    const billed = {
      id: 'ii-1',
      invoice_id: 'inv-old',
      type: 'tuition',
      enrollment_id: 'e1-s-paused-period',
      billing_period_id: PERIOD,
    };
    const r = await runWith(seed([pending], [billed]), { billingPeriodId: PERIOD });
    expect(r.pausedStudents).toEqual([]);
    expect(r.billed).toEqual(['s-normal']);
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

describe('billStudent —— 擋點在「已開過濾」之後（C5）', () => {
  // 規劃（交易外）之後、交易之前被別的 run 開掉了：交易裡重查發現沒東西可開 → 算沒有可開，不報暫停
  const input = {
    orgId: ORG,
    userId: 'u1',
    studentId: 's-paused',
    issuedAt: '2026-01-20',
    dueDate: '2026-02-03',
    invoiceNote: '期繳帳務作業',
    periodMonth: null,
    billingPeriodId: PERIOD,
    range: { start: '2026-02-01', end: '2026-07-31' },
    tuition: [
      { enrollmentId: 'e1-s-paused-period', studentId: 's-paused', amount: 3000, note: null },
    ],
    withMeal: false,
    mealNote: '',
  };
  const billed = {
    id: 'ii-1',
    invoice_id: 'inv-old',
    type: 'tuition',
    enrollment_id: 'e1-s-paused-period',
    billing_period_id: PERIOD,
  };

  it('學費已被別的 run 開掉＋有 pending → NothingToBill（不是 PausedForRenewal）', async () => {
    const db = seed([pending], [billed]);
    const pool = fakeBillingPool({ rows: (t) => db.rows(t), client: db.client as never });
    await expect(billStudent(pool, input)).rejects.toBeInstanceOf(NothingToBill);
  });

  it('還沒開＋有 pending → PausedForRenewal（對照組）', async () => {
    const db = seed([pending]);
    const pool = fakeBillingPool({ rows: (t) => db.rows(t), client: db.client as never });
    await expect(billStudent(pool, input)).rejects.toBeInstanceOf(PausedForRenewal);
  });
});
