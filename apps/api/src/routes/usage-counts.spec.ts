import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb, withMaxRows } from '../test-utils/multi-org-db';
import billingPeriodsRoute from './billing-periods';
import feeTemplatesRoute from './fee-templates';

/**
 * #1314 F1／F2／F4：列表帶引用數，前端才能寫「N 筆在用」。
 * - 價目表 `inUseCount`：引用它的報名**不分狀態**（RESTRICT 不看狀態，要跟刪除的 409 同源）
 * - 收費期間 `overlappingEnrollmentCount`：日期重疊的在讀期繳報名（報名跟期間沒有 FK，判斷同「待開單」）
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER = '00000000-0000-0000-0000-00000000000b';
const TPL_A = '00000000-0000-0000-0000-0000000000a1';
const TPL_B = '00000000-0000-0000-0000-0000000000a2';
const PERIOD = '00000000-0000-0000-0000-0000000000b1';

const enrollment = (row: Record<string, unknown>) => ({
  org_id: ORG,
  status: 'active',
  billing_mode: 'period',
  fee_template_id: null,
  effective_from: '2026-09-01',
  effective_to: null,
  ...row,
});

async function get(
  route: unknown,
  enrollments: Array<Record<string, unknown>>,
  opts: { maxRows?: number } = {},
) {
  const db = createMultiOrgDb({
    fee_templates: [TPL_A, TPL_B].map((id) => ({
      id,
      org_id: ORG,
      name: id,
      billing_mode: 'period',
      amount: '1000',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })),
    billing_periods: [
      {
        id: PERIOD,
        org_id: ORG,
        name: '2026 下學期',
        start_date: '2026-09-01',
        end_date: '2027-01-31',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    enrollments: enrollments.map((row, i) => ({ id: `e${i}`, ...row })),
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', opts.maxRows ? withMaxRows(db.client, opts.maxRows) : db.client);
    set('orgId', ORG);
    await next();
  });
  app.route('/', route as Hono);
  const res = await app.request('/');
  return { status: res.status, body: (await res.json()) as any };
}

describe('GET /api/fee-templates 的 inUseCount（F1／F2）', () => {
  it('數全部狀態的引用報名；沒人用是 0；別 org 的不算', async () => {
    const { status, body } = await get(feeTemplatesRoute, [
      enrollment({ fee_template_id: TPL_A }),
      enrollment({ fee_template_id: TPL_A, status: 'ended' }),
      enrollment({ fee_template_id: TPL_A, status: 'suspended', billing_mode: 'monthly' }),
      enrollment({ fee_template_id: TPL_A, org_id: OTHER }),
    ]);

    expect(status).toBe(200);
    const byId = new Map(body.data.map((t: any) => [t.id, t.inUseCount]));
    expect(byId.get(TPL_A)).toBe(3);
    expect(byId.get(TPL_B)).toBe(0);
  });
});

describe('GET /api/billing-periods 的 overlappingEnrollmentCount（F4）', () => {
  it('只數與期間重疊、在讀、期繳、本 org 的報名', async () => {
    const { status, body } = await get(billingPeriodsRoute, [
      enrollment({}), // 期初開始、沒結束日
      enrollment({ effective_from: '2026-06-01', effective_to: '2026-09-01' }), // 剛好碰到期初
      enrollment({ effective_from: '2027-01-31' }), // 剛好碰到期末
      enrollment({ effective_from: '2026-03-01', effective_to: '2026-08-31' }), // 期前就結束
      enrollment({ effective_from: '2027-02-01' }), // 期後才開始
      enrollment({ status: 'ended' }),
      enrollment({ billing_mode: 'monthly' }),
      enrollment({ org_id: OTHER }),
    ]);

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: PERIOD, overlappingEnrollmentCount: 3 });
  });
});

describe('超過 max_rows 也數得對（計數交給 DB，不撈列回來數）', () => {
  it('1001 筆報名：價目表 inUseCount 與期間 overlappingEnrollmentCount 都是 1001', async () => {
    const many = Array.from({ length: 1001 }, () => enrollment({ fee_template_id: TPL_A }));

    const templates = await get(feeTemplatesRoute, many, { maxRows: 1000 });
    expect(templates.body.data.find((t: any) => t.id === TPL_A).inUseCount).toBe(1001);

    const periods = await get(billingPeriodsRoute, many, { maxRows: 1000 });
    expect(periods.body.data[0].overlappingEnrollmentCount).toBe(1001);
  });
});
