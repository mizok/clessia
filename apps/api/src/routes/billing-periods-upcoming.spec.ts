import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/taipei-date', () => ({ getCurrentTaipeiDateString: () => '2026-10-04' }));

import billingPeriodsApp from './billing-periods';

/**
 * `GET /api/billing-periods/upcoming-unbilled`（#1293）。
 *
 * 替身**真的實作**平面欄位的 `eq`／`gt`／`lte`／`in` —— 守的是「14 天窗口」「只算在讀的期繳」
 * 這幾個條件，替身不篩的話拿掉它們照樣綠。嵌入欄位的條件（`invoices.org_id`）記下來不執行。
 */
type Row = Record<string, unknown>;

function createApp(tables: Record<string, Row[]>) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  const supabase = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const q: any = {
        select: () => q,
        order: () => q,
        eq: (col: string, val: unknown) => {
          calls.push({ table, op: 'eq', args: [col, val] });
          if (!col.includes('.')) filters.push((r) => r[col] === val);
          return q;
        },
        gt: (col: string, val: string) => (filters.push((r) => String(r[col]) > val), q),
        lte: (col: string, val: string) => (filters.push((r) => String(r[col]) <= val), q),
        in: (col: string, vals: unknown[]) => (filters.push((r) => vals.includes(r[col])), q),
        // #1305：先讀 organizations.billing_reminder_days
        maybeSingle: () =>
          Promise.resolve({
            data: (tables[table] ?? []).find((r) => filters.every((f) => f(r))) ?? null,
            error: null,
          }),
        then: (onfulfilled: (value: unknown) => unknown) =>
          Promise.resolve({
            data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))),
            error: null,
          }).then(onfulfilled),
      };
      return q;
    },
  };
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const ctx = c as unknown as { set: (k: string, v: unknown) => void };
    ctx.set('supabase', supabase);
    ctx.set('orgId', 'org-1');
    ctx.set('userId', 'user-1');
    ctx.set('roles', ['admin']);
    ctx.set('campusScope', null);
    await next();
  });
  app.route('/api/billing-periods', billingPeriodsApp);
  return { app, calls };
}

const period = (id: string, start: string, end: string) => ({
  id,
  org_id: 'org-1',
  name: `期 ${id}`,
  start_date: start,
  end_date: end,
});
const enrollment = (over: Row = {}) => ({
  org_id: 'org-1',
  status: 'active',
  billing_mode: 'period',
  effective_from: '2026-09-01',
  effective_to: null,
  ...over,
});

const get = async (tables: Record<string, Row[]>) => {
  const { app, calls } = createApp(tables);
  const res = await app.request('/api/billing-periods/upcoming-unbilled');
  return { res, body: (await res.json()) as { data: Array<Record<string, unknown>> }, calls };
};

describe('GET /api/billing-periods/upcoming-unbilled（#1293）', () => {
  it('14 天內開始、有期繳生、還沒開 → 列出（含距今天數與待開報名數）', async () => {
    const { res, body } = await get({
      billing_periods: [period('p1', '2026-10-15', '2027-01-31')],
      enrollments: [enrollment(), enrollment()],
      invoice_items: [],
    });
    expect(res.status).toBe(200);
    expect(body.data).toEqual([
      {
        periodId: 'p1',
        name: '期 p1',
        startDate: '2026-10-15',
        daysUntil: 11,
        pendingEnrollmentCount: 2,
      },
    ]);
  });

  it('窗口外不列：今天開始的（已經開始了）與 15 天後才開始的', async () => {
    const { body } = await get({
      billing_periods: [
        period('today', '2026-10-04', '2027-01-31'),
        period('edge', '2026-10-18', '2027-01-31'),
        period('far', '2026-10-19', '2027-01-31'),
      ],
      enrollments: [enrollment()],
      invoice_items: [],
    });
    expect(body.data.map((d) => d['periodId'])).toEqual(['edge']);
  });

  /** #1305：提前天數是機構設定（預設 14）。設 7 天：10 天後開始的不列、5 天後的列 */
  it('窗口天數讀機構設定 billing_reminder_days', async () => {
    const { body } = await get({
      organizations: [{ id: 'org-1', billing_reminder_days: 7 }],
      billing_periods: [
        period('in', '2026-10-09', '2027-01-31'),
        period('edge', '2026-10-11', '2027-01-31'),
        period('out', '2026-10-14', '2027-01-31'),
      ],
      enrollments: [enrollment()],
      invoice_items: [],
    });
    expect(body.data.map((d) => d['periodId'])).toEqual(['in', 'edge']);
  });

  it('已經有一筆沒作廢的明細 → 不列；只有作廢的 → 照列', async () => {
    const { body } = await get({
      billing_periods: [
        period('billed', '2026-10-10', '2027-01-31'),
        period('voided', '2026-10-11', '2027-01-31'),
      ],
      enrollments: [enrollment()],
      invoice_items: [
        { billing_period_id: 'billed', invoices: { org_id: 'org-1', voided_at: null } },
        { billing_period_id: 'voided', invoices: { org_id: 'org-1', voided_at: '2026-10-01' } },
      ],
    });
    expect(body.data.map((d) => d['periodId'])).toEqual(['voided']);
  });

  it('沒有該開的（沒有在讀的期繳報名與這期重疊）→ 不列', async () => {
    const { body } = await get({
      billing_periods: [period('p1', '2026-10-15', '2027-01-31')],
      enrollments: [
        enrollment({ billing_mode: 'monthly' }),
        enrollment({ status: 'withdrawn' }),
        enrollment({ effective_to: '2026-10-10' }), // 這期開始前就結束
        enrollment({ effective_from: '2027-02-01' }), // 這期結束後才開始
      ],
      invoice_items: [],
    });
    expect(body.data).toEqual([]);
  });

  it('沒有窗口內的期 → 空陣列，不查報名與明細', async () => {
    const { body, calls } = await get({ billing_periods: [], enrollments: [enrollment()] });
    expect(body.data).toEqual([]);
    expect(calls.some((c) => c.table === 'enrollments' || c.table === 'invoice_items')).toBe(false);
  });

  it('明細經 invoices 篩本機構（invoice_items 沒有 org_id）', async () => {
    const { calls } = await get({
      billing_periods: [period('p1', '2026-10-15', '2027-01-31')],
      enrollments: [enrollment()],
      invoice_items: [],
    });
    expect(calls).toContainEqual({
      table: 'invoice_items',
      op: 'eq',
      args: ['invoices.org_id', 'org-1'],
    });
  });
});
