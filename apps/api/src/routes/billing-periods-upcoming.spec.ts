import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/taipei-date', () => ({ getCurrentTaipeiDateString: () => '2026-10-04' }));

import { createMultiOrgDb, withMaxRows } from '../test-utils/multi-org-db';
import billingPeriodsApp from './billing-periods';

/**
 * `GET /api/billing-periods/upcoming-unbilled`（#1293）。
 *
 * 用 `multi-org-db`：它**真的照條件過濾**（含嵌入欄位 `invoices.org_id`、`or`、head count），
 * 守的是「14 天窗口」「只算在讀的期繳」「別 org 的明細不算開過」這幾個條件 ——
 * 替身不篩的話拿掉它們照樣綠。
 *
 * #1342：兩種計數都交給 DB（每期一支 head count）。`withMaxRows` 模擬 `max_rows = 1000`，
 * 撈列回來數的寫法超過一千筆會靜默少算（或把已開的期誤判成沒開）。
 */
type Row = Record<string, unknown>;

const OTHER_ORG = 'org-2';

async function get(tables: Record<string, Row[]>, opts: { maxRows?: number } = {}) {
  const db = createMultiOrgDb(tables);
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const ctx = c as unknown as { set: (k: string, v: unknown) => void };
    ctx.set('supabase', opts.maxRows ? withMaxRows(db.client, opts.maxRows) : db.client);
    ctx.set('orgId', 'org-1');
    ctx.set('userId', 'user-1');
    ctx.set('roles', ['admin']);
    ctx.set('campusScope', null);
    await next();
  });
  app.route('/api/billing-periods', billingPeriodsApp);
  const res = await app.request('/api/billing-periods/upcoming-unbilled');
  return { res, body: (await res.json()) as { data: Array<Record<string, unknown>> } };
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

  it('沒有窗口內的期 → 空陣列', async () => {
    const { body } = await get({ billing_periods: [], enrollments: [enrollment()] });
    expect(body.data).toEqual([]);
  });

  it('明細經 invoices 篩本機構：別 org 的有效明細不算這期開過', async () => {
    const { body } = await get({
      billing_periods: [period('p1', '2026-10-15', '2027-01-31')],
      enrollments: [enrollment()],
      invoice_items: [
        { billing_period_id: 'p1', invoices: { org_id: OTHER_ORG, voided_at: null } },
      ],
    });
    expect(body.data.map((d) => d['periodId'])).toEqual(['p1']);
  });

  it('別 org 的期繳報名不算進待開數', async () => {
    const { body } = await get({
      billing_periods: [period('p1', '2026-10-15', '2027-01-31')],
      enrollments: [enrollment(), enrollment({ org_id: OTHER_ORG })],
      invoice_items: [],
    });
    expect(body.data[0]?.['pendingEnrollmentCount']).toBe(1);
  });

  // #1342 陷阱：PostgREST 撈列只回前 1000 列、不報錯
  it('待開報名破千：數字是 1001 不是 1000', async () => {
    const { body } = await get(
      {
        billing_periods: [period('p1', '2026-10-15', '2027-01-31')],
        enrollments: Array.from({ length: 1001 }, () => enrollment()),
        invoice_items: [],
      },
      { maxRows: 1000 },
    );
    expect(body.data[0]?.['pendingEnrollmentCount']).toBe(1001);
  });

  it('明細破千：前一期 1000 筆作廢明細擠掉後一期那筆有效的 → 後一期仍判為已開', async () => {
    const { body } = await get(
      {
        billing_periods: [
          period('a', '2026-10-10', '2027-01-31'),
          period('b', '2026-10-11', '2027-01-31'),
        ],
        enrollments: [enrollment()],
        invoice_items: [
          ...Array.from({ length: 1000 }, () => ({
            billing_period_id: 'a',
            invoices: { org_id: 'org-1', voided_at: '2026-10-01' },
          })),
          { billing_period_id: 'b', invoices: { org_id: 'org-1', voided_at: null } },
        ],
      },
      { maxRows: 1000 },
    );
    expect(body.data.map((d) => d['periodId'])).toEqual(['a']);
  });
});
