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
      for (const method of ['select', 'eq', 'is', 'in', 'gte', 'lte', 'order']) {
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

function appWith(supabase: unknown, scope: string[] | null = null) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', supabase);
    set('orgId', '00000000-0000-0000-0000-0000000000aa');
    set('userId', 'u1');
    set('campusScope', scope);
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
