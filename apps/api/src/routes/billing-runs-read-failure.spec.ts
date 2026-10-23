import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import billingRunsRoute from './billing-runs';

/**
 * #1934：帳務作業的**每一段讀取失敗都要回 5xx，而且一筆都不寫**。
 *
 * 原本每支讀取都只拿 `data`、不看 `error`。`.in()` 帶上千個 id 會 414，錯誤被吞掉後：
 * - 學費冪等查詢失敗 → `alreadyBilled` 是空的 → **已開過帳的報名整批再開一次**（DB 沒有 UNIQUE 擋）
 * - 餐費蓋章總額查詢失敗 → 每筆都算成 0 → 全部判成異常、應收 0 → **repair 把餐費改成 0**
 *
 * 這支用替身在每一段讀取注入錯誤，斷言回 5xx、`inserts`／`updates` 一筆都沒有。
 */

type Resolve = (table: string, ops: string[]) => { data?: unknown; error?: unknown } | undefined;

const ENROLLMENT = '00000000-0000-0000-0000-0000000000e1';
const PERIOD = '00000000-0000-0000-0000-0000000000b1';
const CAMPUS = '00000000-0000-0000-0000-0000000000c1';
const BOOM = { message: 'URI too long', code: '414' };

afterEach(() => vi.restoreAllMocks());

/** 正常劇本：一筆月繳報名、還沒開過帳、有一筆待開的餐費、一筆金額對不上的餐費 item */
const healthy: Resolve = (table, ops) => {
  if (table === 'billing_periods') {
    return { data: { id: PERIOD, start_date: '2026-03-01', end_date: '2026-03-31' } };
  }
  if (table === 'enrollments' && ops.includes('is')) return { data: [] };
  if (table === 'enrollments' && ops.filter((o) => o === 'in').length === 2) {
    return { data: [{ student_id: 's1' }] }; // 受限者的餐費學生
  }
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
  if (table === 'invoice_items' && ops.includes('update')) return { data: null };
  if (table === 'invoice_items' && ops.includes('in')) return { data: [] }; // 學費冪等：還沒開過
  if (table === 'invoice_items') {
    // 餐費異常掃描：一筆 item 100 元，蓋章總額 80 元
    return {
      data: [
        {
          id: 'meal-item',
          amount: 100,
          invoices: { org_id: 'org', voided_at: null, campus_id: CAMPUS },
        },
      ],
    };
  }
  if (table === 'meal_records' && ops.includes('update')) return { data: [{ unit_price: 70 }] };
  if (table === 'meal_records' && ops.includes('in')) {
    return { data: [{ invoice_item_id: 'meal-item', unit_price: 80 }] };
  }
  if (table === 'meal_records') return { data: [{ student_id: 's1' }] };
  if (table === 'invoices') return { data: { id: 'new-invoice' } };
  if (table === 'organizations') return { data: { invoice_due_days: 14 } };
  return { data: [] };
};

function tableFake(fail: (table: string, ops: string[]) => boolean) {
  const writes: Array<{ table: string; op: string }> = [];
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
      for (const method of ['insert', 'update']) {
        query[method] = () => {
          ops.push(method);
          writes.push({ table, op: method });
          return query;
        };
      }
      const settle = () =>
        Promise.resolve(
          fail(table, ops)
            ? { data: null, error: BOOM }
            : { data: null, error: null, ...healthy(table, ops) },
        );
      query['maybeSingle'] = settle;
      query['single'] = settle;
      query['then'] = (ok: (v: unknown) => unknown, ng: (e: unknown) => unknown) =>
        settle().then(ok, ng);
      return query;
    },
  };
  return { client, writes };
}

function appWith(supabase: unknown, scope: string[] | null = null, pool?: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', supabase);
    set('orgId', '00000000-0000-0000-0000-0000000000aa');
    set('userId', 'u1');
    set('campusScope', scope);
    if (pool) set('auth', { pool });
    await next();
  });
  app.route('/', billingRunsRoute as unknown as Hono);
  return app;
}

const post = (app: Hono, path: string, body?: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const isRead = (ops: string[]) => !ops.includes('insert') && !ops.includes('update');

describe('POST /api/billing-runs：開帳前的每一段讀取失敗 → 5xx、一筆都不寫（#1934）', () => {
  it('正常劇本會寫（對照組：證明下面的「沒寫」不是因為劇本本來就不寫）', async () => {
    const fake = tableFake(() => false);
    const res = await post(appWith(fake.client), '/', { periodMonth: '2026-03' });
    expect(res.status).toBe(200);
    expect(fake.writes.length).toBeGreaterThan(0);
  });

  it.each([
    [
      '學費候選（enrollments）',
      (t: string, o: string[]) => t === 'enrollments' && !o.includes('is') && !o.includes('in'),
    ],
    [
      '學費冪等查詢（invoice_items .in enrollment_id）',
      (t: string, o: string[]) => t === 'invoice_items' && o.includes('in') && isRead(o),
    ],
    [
      '待開餐費（meal_records）',
      (t: string, o: string[]) => t === 'meal_records' && !o.includes('in') && isRead(o),
    ],
    ['帳單期限（organizations）', (t: string) => t === 'organizations'],
  ] as const)('月 run：%s 讀取失敗', async (_label, fail) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = tableFake(fail);
    const res = await post(appWith(fake.client), '/', { periodMonth: '2026-03' });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe('READ_FAILED');
    expect(fake.writes).toEqual([]);
  });

  it('受限者：餐費學生的分校過濾（enrollments 兩個 .in）讀取失敗', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = tableFake(
      (t, o) => t === 'enrollments' && o.filter((x) => x === 'in').length === 2,
    );
    const res = await post(appWith(fake.client, [CAMPUS]), '/', { periodMonth: '2026-03' });
    expect(res.status).toBe(500);
    expect(fake.writes).toEqual([]);
  });

  it('期 run：收費期間讀取失敗 → 500（不是 404，也不是當成不存在）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = tableFake((t) => t === 'billing_periods');
    const res = await post(appWith(fake.client), '/', { billingPeriodId: PERIOD });
    expect(res.status).toBe(500);
    expect(fake.writes).toEqual([]);
  });

  it('開完帳之後的異常掃描失敗 → 500，訊息說帳單已經開了（重跑是冪等的）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = tableFake((t, o) => t === 'meal_records' && o.includes('in'));
    const res = await post(appWith(fake.client), '/', { periodMonth: '2026-03' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('SCAN_FAILED_AFTER_RUN');
    expect(body.error).toContain('已開立');
  });
});

describe('GET /anomalies、POST /repair：掃描讀取失敗 → 5xx，repair 一筆都不改（#1934）', () => {
  it('對照組：正常劇本 repair 會改那一筆', async () => {
    const fake = tableFake(() => false);
    const res = await post(appWith(fake.client), '/repair');
    expect(res.status).toBe(200);
    expect(fake.writes.filter((w) => w.table === 'invoice_items')).toHaveLength(1);
  });

  it.each([
    [
      '餐費 item（invoice_items）',
      (t: string, o: string[]) => t === 'invoice_items' && !o.includes('in') && isRead(o),
    ],
    [
      '蓋章總額（meal_records .in invoice_item_id）',
      (t: string, o: string[]) => t === 'meal_records' && o.includes('in'),
    ],
    [
      '沒有計費模式的報名（enrollments .is）',
      (t: string, o: string[]) => t === 'enrollments' && o.includes('is'),
    ],
  ] as const)('%s 讀取失敗', async (_label, fail) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const anomalies = await appWith(tableFake(fail).client).request('/anomalies');
    expect(anomalies.status).toBe(500);

    const fake = tableFake(fail);
    const repair = await post(appWith(fake.client), '/repair');
    // repair 不掃「沒有計費模式」，那一支壞了也照樣能修餐費
    if (_label.startsWith('沒有計費模式')) {
      expect(repair.status).toBe(200);
      return;
    }
    expect(repair.status).toBe(500);
    expect(fake.writes).toEqual([]);
  });
});

describe('repair 的比例防呆（#1934）：對不上的太多就不修', () => {
  it('門檻：多於 3 筆而且超過掃描總數的 20%', async () => {
    const { repairLooksWrong } = await import('./billing-runs');
    expect(repairLooksWrong(3, 3)).toBe(false); // 3 筆以內一律照修
    expect(repairLooksWrong(4, 20)).toBe(false); // 4／20 = 20%，沒超過
    expect(repairLooksWrong(5, 20)).toBe(true); // 5／20 = 25%
    expect(repairLooksWrong(4, 10)).toBe(true);
    expect(repairLooksWrong(40, 1000)).toBe(false); // 4%
  });

  /** n 筆餐費 item、其中 bad 筆金額對不上蓋章總額 */
  function mealItems(n: number, bad: number, paid = 0, refunded = 0) {
    const writes: Array<{ table: string; op: string }> = [];
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
        for (const method of ['insert', 'update']) {
          query[method] = () => {
            ops.push(method);
            writes.push({ table, op: method });
            return query;
          };
        }
        const settle = () => {
          if (table === 'invoice_items' && !ops.includes('update')) {
            return Promise.resolve({
              data: Array.from({ length: n }, (_, i) => ({
                id: `item-${i}`,
                amount: 100,
                invoices: {
                  org_id: 'org',
                  voided_at: null,
                  // 前 paid 筆的帳單已經收過款（使用者 10-23 裁定：repair 不改）
                  payment_records:
                    i < paid
                      ? [{ amount: 100, kind: 'payment' }]
                      : i < paid + refunded
                        ? // 收了又全額退：淨收款 0，視同沒收過
                          [
                            { amount: 100, kind: 'payment' },
                            { amount: 100, kind: 'refund' },
                          ]
                        : [],
                },
              })),
              error: null,
            });
          }
          if (table === 'meal_records') {
            return Promise.resolve({
              data: Array.from({ length: n }, (_, i) => ({
                invoice_item_id: `item-${i}`,
                unit_price: i < bad ? 80 : 100,
              })),
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        };
        query['then'] = (ok: (v: unknown) => unknown, ng: (e: unknown) => unknown) =>
          settle().then(ok, ng);
        return query;
      },
    };
    return { client, writes };
  }

  it('20 筆裡 10 筆對不上 → 409、一筆都不改', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = mealItems(20, 10);
    const res = await post(appWith(fake.client), '/repair');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('REPAIR_RATIO_TOO_HIGH');
    expect(fake.writes).toEqual([]);
  });

  it('20 筆裡 2 筆對不上 → 照修那 2 筆', async () => {
    const fake = mealItems(20, 2);
    const res = await post(appWith(fake.client), '/repair');
    expect(res.status).toBe(200);
    expect(fake.writes.filter((w) => w.table === 'invoice_items')).toHaveLength(2);
  });

  it('帳單已收款的對不上 → 不改、計在 skippedPaid（使用者 10-23 裁定，REST 路徑）', async () => {
    const fake = mealItems(20, 2, 1);
    const res = await post(appWith(fake.client), '/repair');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repaired: number; skippedPaid: number };
    expect(body).toMatchObject({ repaired: 1, skippedPaid: 1 });
    expect(fake.writes.filter((w) => w.table === 'invoice_items')).toHaveLength(1);
  });

  it('收了又全額退（淨收款 0）→ 照修，不算 skippedPaid（REST 路徑）', async () => {
    const fake = mealItems(20, 2, 0, 1);
    const res = await post(appWith(fake.client), '/repair');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ repaired: 2, skippedPaid: 0 });
    expect(fake.writes.filter((w) => w.table === 'invoice_items')).toHaveLength(2);
  });
});

/**
 * repair 前「哪些帳單已經收款」讀不到 → 500、一筆都不改（審核席 @86bc814b W4）。
 * 讀成空集合的話，已繳的帳單會被系統改應收 —— 正是使用者 10-23 裁定要避免的。
 */
describe('POST /repair：已收款查詢讀取失敗 → 500、一筆都不改（#1936）', () => {
  it('REST 路徑（沒有 pool）：invoice_items 帶 payment_records 那支讀取失敗', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // 掃描（不帶 .in）照常；已收款查詢是帶 `.in('id', …)` 的那支 invoice_items 讀取
    const fake = tableFake((t, o) => t === 'invoice_items' && o.includes('in') && isRead(o));
    const res = await post(appWith(fake.client), '/repair');
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe('READ_FAILED');
    expect(fake.writes).toEqual([]);
  });

  it('pg 路徑：payment_records 那句丟錯', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = tableFake(() => false);
    const pool = {
      query: async (sql: string) => {
        if (sql.includes('payment_records')) throw new Error('boom');
        // 蓋章總額：那筆 100 元的 item 只蓋了 80 → 對不上，repair 會想改它
        if (sql.includes('sum(m.unit_price)')) {
          return { rows: [{ invoice_item_id: 'meal-item', total: '80' }] };
        }
        throw new Error(`認不得的語句：${sql.slice(0, 60)}`);
      },
    };
    const res = await post(appWith(fake.client, null, pool), '/repair');
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe('READ_FAILED');
    expect(fake.writes).toEqual([]);
  });

  it('對照組：pg 路徑讀得到（沒有收款）→ 照修那一筆', async () => {
    const fake = tableFake(() => false);
    const pool = {
      query: async (sql: string) => {
        if (sql.includes('payment_records')) return { rows: [] };
        if (sql.includes('sum(m.unit_price)')) {
          return { rows: [{ invoice_item_id: 'meal-item', total: '80' }] };
        }
        throw new Error(`認不得的語句：${sql.slice(0, 60)}`);
      },
    };
    const res = await post(appWith(fake.client, null, pool), '/repair');
    expect(res.status).toBe(200);
    expect(fake.writes.filter((w) => w.table === 'invoice_items')).toHaveLength(1);
  });
});
