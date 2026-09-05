import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import invoicesRoute from './invoices';

/**
 * 帳單列表的分頁有**兩條路徑**（見 invoices.ts 的註解）：帶推導條件時全撈再篩再切，
 * 沒帶時走 DB 分頁。這組測試守的是兩條路徑的 `meta.total` 都要是**全體筆數**。
 */

interface FakeRow {
  id: string;
  amount: number;
  paid: number;
}

/** 造一列 invoice 的原始資料（含巢狀 items / payments，狀態由它們推導） */
function invoiceRow({ id, amount, paid }: FakeRow) {
  return {
    id,
    org_id: '00000000-0000-0000-0000-0000000000aa',
    student_id: '00000000-0000-0000-0000-0000000000bb',
    issued_at: '2026-03-01',
    due_date: '2026-03-15',
    note: null,
    created_by: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    students: { name: '王小明' },
    invoice_items: [{ id: `${id}-i`, type: 'tuition', amount, created_at: '2026-03-01T00:00:00Z' }],
    payment_records:
      paid > 0
        ? [{ id: `${id}-p`, kind: 'payment', amount: paid, method: 'cash', paid_at: '2026-03-02' }]
        : [],
  };
}

/**
 * 只實作這支 handler 用到的鏈：`.select(cols, opts).eq().lt().range().order()`。
 * `range` 被呼叫時就照它切 —— 模擬 DB 分頁；`count` 一律回全體筆數，那正是
 * `meta.total` 該拿的東西。
 */
function fakeSupabase(rows: ReturnType<typeof invoiceRow>[]) {
  const calls = { ranged: false, ltArgs: [] as Array<[string, unknown]> };

  const builder: Record<string, unknown> = {};
  let sliced = rows;

  const chain = () => builder as never;
  Object.assign(builder, {
    select: (_cols: string, _opts?: unknown) => chain(),
    eq: () => chain(),
    lt: (column: string, value: unknown) => {
      calls.ltArgs.push([column, value]);
      return chain();
    },
    range: (from: number, to: number) => {
      calls.ranged = true;
      sliced = rows.slice(from, to + 1);
      return chain();
    },
    order: () => Promise.resolve({ data: sliced, count: rows.length, error: null }),
    // `logAudit` 走的是 profiles.maybeSingle → audit_logs.insert。
    // 少了它們，稽核會在 logAudit 自己的 try/catch 裡靜默失敗
    //（只印 `[audit] log failed`），測試看不到、CI 也不會紅。
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    insert: () => Promise.resolve({ error: null }),
  });

  return { calls, client: { from: () => builder } };
}

function appWith(supabase: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', supabase);
    set('orgId', '00000000-0000-0000-0000-0000000000aa');
    set('userId', 'u1');
    await next();
  });
  app.route('/', invoicesRoute as unknown as Hono);
  return app;
}

const many = Array.from({ length: 25 }, (_, i) =>
  invoiceRow({
    id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    amount: 1000,
    paid: 0,
  }),
);

describe('GET /api/invoices —— meta.total', () => {
  /**
   * **這是這次漏掉的形狀。** 原本 total 取的是 `.range()` 切頁之後的筆數，
   * 所以除了最後一頁以外永遠等於 pageSize，前端算出的總頁數永遠是 1 或 2。
   */
  it('DB 分頁路徑：第二頁的 total 是全體筆數，不是當頁筆數', async () => {
    const { client, calls } = fakeSupabase(many);
    const res = await appWith(client).request('/?page=2&pageSize=10');
    const body = (await res.json()) as { data: unknown[]; meta: { total: number } };

    expect(calls.ranged).toBe(true); // 確認真的走了 DB 分頁那條
    expect(body.data).toHaveLength(10);
    expect(body.meta.total).toBe(25);
  });

  it('第一頁也一樣', async () => {
    const { client } = fakeSupabase(many);
    const res = await appWith(client).request('/?page=1&pageSize=10');

    expect(((await res.json()) as { meta: { total: number } }).meta.total).toBe(25);
  });
});

describe('GET /api/invoices —— status 篩選', () => {
  const mixed = [
    invoiceRow({ id: '00000000-0000-0000-0000-000000000001', amount: 1000, paid: 0 }), // unpaid
    invoiceRow({ id: '00000000-0000-0000-0000-000000000002', amount: 1000, paid: 400 }), // partial
    invoiceRow({ id: '00000000-0000-0000-0000-000000000003', amount: 1000, paid: 1000 }), // paid
  ];

  // status 是推導值，DB 濾不掉 —— 走「全撈再篩再切」那條，而且不能呼叫 range()
  it('只回符合狀態的，total 是篩後總數', async () => {
    const { client, calls } = fakeSupabase(mixed);
    const res = await appWith(client).request('/?status=partial');
    const body = (await res.json()) as { data: { status: string }[]; meta: { total: number } };

    expect(calls.ranged).toBe(false);
    expect(body.data.map((row) => row.status)).toEqual(['partial']);
    expect(body.meta.total).toBe(1);
  });

  it('繳清的也篩得出來', async () => {
    const { client } = fakeSupabase(mixed);
    const res = await appWith(client).request('/?status=paid');

    expect(((await res.json()) as { meta: { total: number } }).meta.total).toBe(1);
  });

  // overdue 與 status 可並用：兩個都是推導條件，走同一條路徑
  it('overdue 與 status 可以並用', async () => {
    const { client } = fakeSupabase(mixed);
    const res = await appWith(client).request('/?overdue=true&status=unpaid');
    const body = (await res.json()) as { data: { status: string }[] };

    expect(body.data.every((row) => row.status === 'unpaid')).toBe(true);
  });
});

/**
 * P0-1 那批 UTC 時區 bug 的同一族：`overdue` 過濾原本用
 * `new Date().toISOString().slice(0, 10)`（UTC）算「今天」。這條**不是**預設值算錯
 * 一天那種——它是過濾條件，算錯一天會讓整份清單的成員錯位：在台北凌晨看繳費頁，
 * 一批帳單會被錯誤地列為逾期或錯誤地不列，行政可能因此去催繳一個還沒到期的家長。
 *
 * **這裡的觀測窗口刻意涵蓋出錯的條件**（照 taipei-date.spec.ts 與 #368 的形狀）：
 * 系統時間設在「UTC 還是前一天、台北已經是今天凌晨」的那個瞬間，兩邊給的日期
 * 不一樣，這裡斷言 `.lt('due_date', ...)` 傳的是台北的今天。
 */
describe('GET /api/invoices?overdue —— 台北凌晨那個窗（#402 同一族）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('UTC 還在 09-05 傍晚，但台北已經是 09-06 凌晨 —— 過濾條件要用台北的今天', async () => {
    // 台北 2026-09-06T01:00:00+08:00 = UTC 2026-09-05T17:00:00Z，正是 #402 出事的那個窗
    vi.setSystemTime(new Date('2026-09-05T17:00:00Z'));

    const { client, calls } = fakeSupabase([]);
    await appWith(client).request('/?overdue=true');

    expect(calls.ltArgs).toEqual([['due_date', '2026-09-06']]);
    // 對照組：naive 的 UTC 算法在這個時刻會算成 09-05，不是 09-06——
    // 這正是「一批帳單被錯誤地列為逾期或錯誤地不列」的根因形狀
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-09-05');
  });
});
