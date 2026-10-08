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
  const calls = {
    ranged: false,
    ranges: [] as Array<[number, number]>,
    ltArgs: [] as Array<[string, unknown]>,
    gteArgs: [] as Array<[string, unknown]>,
    lteArgs: [] as Array<[string, unknown]>,
  };

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
    // `dueWithin` 用的是區間 —— 替身少實作一個運算子的話,新參數會炸在
    // `gte is not a function`,而那跟「這個篩選沒生效」長得完全不同(它會紅)。
    // 這裡刻意**記下參數**而不是只回 chain:區間的兩端各錯一天都不會讓筆數變,
    // 只會讓成員錯位,所以要斷言送出去的值。
    gte: (column: string, value: unknown) => {
      calls.gteArgs.push([column, value]);
      return chain();
    },
    lte: (column: string, value: unknown) => {
      calls.lteArgs.push([column, value]);
      return chain();
    },
    range: (from: number, to: number) => {
      calls.ranged = true;
      calls.ranges.push([from, to]);
      sliced = rows.slice(from, to + 1);
      return chain();
    },
    order: () => chain(),
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: sliced, count: rows.length, error: null }),
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
    set('campusScope', null);
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

  // status 是推導值，DB 濾不掉 —— 走「全撈再篩再切」那條：range 是撈到底的整頁，不是請求的那一頁
  it('只回符合狀態的，total 是篩後總數', async () => {
    const { client, calls } = fakeSupabase(mixed);
    const res = await appWith(client).request('/?status=partial');
    const body = (await res.json()) as { data: { status: string }[]; meta: { total: number } };

    expect(calls.ranges).toEqual([[0, 999]]);
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

/**
 * `outstanding` 與 `dueWithin`（#639）。三個篩選是**同一個母體的子集**,
 * 差別只在日期那一半 —— 所以這組測試守兩件事:
 * ①「未繳清」那一半三者共用（`status !== 'paid'`）
 * ② 日期那一半各自送出**不同**的查詢形狀,而且**互不重疊**
 *
 * 為什麼要斷言查詢形狀而不只是回傳筆數:區間的兩端各錯一天**不會讓筆數變**,
 * 只會讓成員錯位 —— 而錯位的後果是行政去催一個還沒到期的家長。
 */
describe('GET /api/invoices —— outstanding / dueWithin（#639）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const rows = [
    invoiceRow({ id: 'a', amount: 1000, paid: 0 }), // unpaid
    invoiceRow({ id: 'b', amount: 1000, paid: 400 }), // partial
    invoiceRow({ id: 'c', amount: 1000, paid: 1000 }), // paid
  ];

  it('outstanding=true 給 unpaid ∪ partial —— 那正是 status 單選表達不出來的那個集合', async () => {
    const { client, calls } = fakeSupabase(rows);
    const res = await appWith(client).request('/?outstanding=true');
    const body = (await res.json()) as { data: Array<{ id: string }>; meta: { total: number } };

    expect(body.data.map((r) => r.id)).toEqual(['a', 'b']);
    expect(body.meta.total).toBe(2);
    // **沒有下任何日期條件** —— outstanding 是催繳母體,含還沒發收費袋的那些
    expect(calls.ltArgs).toEqual([]);
    expect(calls.gteArgs).toEqual([]);
    expect(calls.lteArgs).toEqual([]);
  });

  it('dueWithin=7 下的是閉區間 [台北今天, 今天+7]，且不含逾期那一側', async () => {
    // 台北 2026-09-06 凌晨,UTC 還在 09-05 —— 沿用 overdue 那組的觀測窗
    vi.setSystemTime(new Date('2026-09-05T17:00:00Z'));

    const { client, calls } = fakeSupabase([]);
    await appWith(client).request('/?dueWithin=7');

    expect(calls.gteArgs).toEqual([['due_date', '2026-09-06']]);
    expect(calls.lteArgs).toEqual([['due_date', '2026-09-13']]);
    // 跟 overdue 不重疊:那支是 `< 今天`,這支從今天開始
    expect(calls.ltArgs).toEqual([]);
  });

  it('dueWithin 收到非數字時當作沒帶 —— 不要靜靜篩成空的', async () => {
    const { client, calls } = fakeSupabase(rows);
    const res = await appWith(client).request('/?dueWithin=abc');
    const body = (await res.json()) as { data: Array<{ id: string }> };

    // 沒有下日期條件,也沒有把 paid 那筆篩掉 —— 就是「沒帶這個參數」
    expect(calls.gteArgs).toEqual([]);
    expect(body.data.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('dueWithin=0 是有效的（只看今天到期）—— 不能被當成沒帶', async () => {
    vi.setSystemTime(new Date('2026-09-05T17:00:00Z'));
    const { client, calls } = fakeSupabase([]);
    await appWith(client).request('/?dueWithin=0');

    expect(calls.gteArgs).toEqual([['due_date', '2026-09-06']]);
    expect(calls.lteArgs).toEqual([['due_date', '2026-09-06']]);
  });

  it('三個篩選都會篩掉已繳清 —— 「未繳清」那一半是共用的', async () => {
    for (const qs of ['outstanding=true', 'overdue=true', 'dueWithin=7']) {
      const { client } = fakeSupabase(rows);
      const res = await appWith(client).request(`/?${qs}`);
      const body = (await res.json()) as { data: Array<{ id: string }> };
      expect(
        body.data.map((r) => r.id),
        qs,
      ).not.toContain('c');
    }
  });
});

/**
 * **#901：`POST /{id}/reminders` 漏接稽核。**
 *
 * 同檔另外四支寫入（`:353 / :432 / :478 / :564`）都有 `logAudit`，只有催繳沒有。
 *
 * ⚠️ **查「有沒有稽核」要 grep `logAudit(` 本身，不要 grep action 字串** ——
 * 收款那支的 action 是三元運算不是字面量
 * （`body.kind === 'refund' ? 'refund' : 'payment'`，`invoices.ts:571`），
 * `grep -oE "action: '[a-z_.]+'"` 抓不到它，會讓人以為它也漏了。
 */
describe('POST /api/invoices/{id}/reminders —— 稽核（#901）', () => {
  const INVOICE = '00000000-0000-0000-0000-00000000001a';

  /** 記下所有 `insert`，好斷言 `audit_logs` 真的多了一列 */
  function recordingSupabase(inserts: Array<{ table: string; rows: unknown }>, found = true) {
    const builder: Record<string, unknown> = {};
    let table = '';
    const chain = () => builder as never;
    Object.assign(builder, {
      select: () => chain(),
      eq: () => chain(),
      insert: (rows: unknown) => {
        inserts.push({ table, rows });
        return Promise.resolve({ error: null });
      },
      maybeSingle: () =>
        Promise.resolve({
          data: table === 'invoices' ? (found ? { id: INVOICE } : null) : null,
          error: null,
        }),
    });

    return {
      from(name: string) {
        table = name;
        return builder;
      },
    };
  }

  async function remind(inserts: Array<{ table: string; rows: unknown }>, found = true) {
    const res = await appWith(recordingSupabase(inserts, found)).request(`/${INVOICE}/reminders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'line', note: '第一次催繳' }),
    });
    // fire-and-forget + 兩層 await，不排空 microtask 佇列的話會斷言在寫入之前
    await new Promise((r) => setTimeout(r, 0));
    return res;
  }

  const auditRowsIn = (inserts: Array<{ table: string; rows: unknown }>) =>
    inserts.filter((i) => i.table === 'audit_logs').map((i) => i.rows);

  it('記錄一次催繳之後 audit_logs 多一列，記得住用哪個管道', async () => {
    const inserts: Array<{ table: string; rows: unknown }> = [];

    await remind(inserts);

    expect(inserts.some((i) => i.table === 'payment_reminders')).toBe(true);
    expect(auditRowsIn(inserts)).toEqual([
      expect.objectContaining({
        resource_type: 'invoice',
        resource_id: INVOICE,
        action: 'invoice.remind',
        details: expect.objectContaining({ method: 'line' }),
      }),
    ]);
  });

  // 帳單不存在時提早 404，**什麼都沒寫，所以也不該有稽核**。
  it('帳單不存在時兩張表都不寫', async () => {
    const inserts: Array<{ table: string; rows: unknown }> = [];

    const res = await remind(inserts, false);

    expect(res.status).toBe(404);
    expect(inserts.some((i) => i.table === 'payment_reminders')).toBe(false);
    expect(auditRowsIn(inserts)).toEqual([]);
  });
});

// ============================================================
// #898 帳單作廢
// ============================================================

/**
 * 按 `from()` 記錄**每一條鏈**的替身：每次 `from(table)` 開一條新鏈，鏈上的每個呼叫
 * （`update` / `is` / `in` …）連同參數都記下來。作廢的正確與否大半在
 * 「送出去的查詢長什麼樣」（有沒有 `.is('voided_at', null)`、解章解的是哪些 item），
 * 替身回的資料分不出對錯，所以斷言查詢本身（billing-api charter「替身分不出對錯時」）。
 *
 * 跟真的 postgrest builder 一樣，**鏈上任何一點都可以 await**（thenable），
 * 結果由 `resolve(chain)` 依表與操作決定。
 */
interface Chain {
  table: string;
  calls: Array<[string, ...unknown[]]>;
}

function chainFake(resolve: (chain: Chain) => { data?: unknown; error?: unknown; count?: number }) {
  const chains: Chain[] = [];

  const client = {
    from(table: string) {
      const chain: Chain = { table, calls: [] };
      chains.push(chain);
      const query: Record<string, unknown> = {};
      for (const method of [
        'select',
        'eq',
        'is',
        'in',
        'lt',
        'gte',
        'lte',
        'range',
        'order',
        'update',
        'insert',
        'delete',
      ]) {
        query[method] = (...args: unknown[]) => {
          chain.calls.push([method, ...args]);
          return query;
        };
      }
      const settle = () => Promise.resolve({ data: null, error: null, ...resolve(chain) });
      query['maybeSingle'] = () => {
        chain.calls.push(['maybeSingle']);
        return settle();
      };
      query['single'] = () => {
        chain.calls.push(['single']);
        return settle();
      };
      query['then'] = (ok: (v: unknown) => unknown, ng: (e: unknown) => unknown) =>
        settle().then(ok, ng);
      return query;
    },
  };

  const has = (chain: Chain, method: string) => chain.calls.some(([m]) => m === method);
  const argsOf = (chain: Chain, method: string) =>
    chain.calls.filter(([m]) => m === method).map(([, ...args]) => args);

  return { client, chains, has, argsOf };
}

const VOID_ID = '00000000-0000-0000-0000-0000000008a0';

/** 帳單原始列：預設是一張收了又全退、淨額 0、可以作廢的帳單，含一筆學費與一筆餐費 */
function voidableRow(overrides: Record<string, unknown> = {}) {
  return {
    ...invoiceRow({ id: VOID_ID, amount: 3000, paid: 0 }),
    invoice_items: [
      { id: 'item-tuition', type: 'tuition', amount: 3000 },
      { id: 'item-meal', type: 'meal', amount: 900 },
    ],
    payment_records: [
      { id: 'p1', kind: 'payment', amount: 3900, method: 'cash', paid_at: '2026-03-02' },
      { id: 'p2', kind: 'refund', amount: 3900, method: 'cash', paid_at: '2026-03-03' },
    ],
    voided_at: null,
    voided_by: null,
    void_reason: null,
    ...overrides,
  };
}

/**
 * 作廢流程的預設劇本：撈得到帳單、沒有堂數包、update 成功回一列、解章回兩筆。
 * 撈帳單的第二次（作廢後回傳）回已作廢的版本。
 */
function voidScenario(
  opts: {
    row?: Record<string, unknown> | null;
    sessionPacks?: number;
    updated?: unknown[];
    updateError?: unknown;
  } = {},
) {
  const row = opts.row === undefined ? voidableRow() : opts.row;
  let invoiceReads = 0;
  return chainFake((chain) => {
    const ops = chain.calls.map(([m]) => m);
    if (chain.table === 'invoices' && ops.includes('update')) {
      return { data: opts.updated ?? [{ id: VOID_ID }], error: opts.updateError ?? null };
    }
    if (chain.table === 'invoices') {
      invoiceReads += 1;
      if (!row) return { data: null };
      return {
        data:
          invoiceReads === 1
            ? row
            : { ...row, voided_at: '2026-09-30T08:00:00Z', voided_by: 'u1', void_reason: '開錯月' },
      };
    }
    if (chain.table === 'session_packs') return { data: [], count: opts.sessionPacks ?? 0 };
    if (chain.table === 'meal_records') return { data: [{ id: 'm1' }, { id: 'm2' }] };
    return { data: null };
  });
}

async function postVoid(client: unknown, reason: unknown = '開錯月') {
  const res = await appWith(client).request(`/${VOID_ID}/void`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  await new Promise((r) => setTimeout(r, 0)); // logAudit 是 fire-and-forget
  return res;
}

describe('POST /api/invoices/{id}/void —— 前置檢查（使用者裁決 2026-09-30）', () => {
  const invoiceUpdates = (fake: ReturnType<typeof chainFake>) =>
    fake.chains.filter((c) => c.table === 'invoices' && fake.has(c, 'update'));

  it('帳單不存在 → 404，什麼都不寫', async () => {
    const fake = voidScenario({ row: null });
    const res = await postVoid(fake.client);

    expect(res.status).toBe(404);
    expect(invoiceUpdates(fake)).toEqual([]);
  });

  it('已作廢 → 409 ALREADY_VOIDED（不可撤銷，也不能重複作廢）', async () => {
    const fake = voidScenario({
      row: voidableRow({ voided_at: '2026-09-01T00:00:00Z', voided_by: 'u9', void_reason: 'x' }),
    });
    const res = await postVoid(fake.client);

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('ALREADY_VOIDED');
    expect(invoiceUpdates(fake)).toEqual([]);
  });

  it('淨收款 > 0 → 409 NET_PAID_NONZERO，訊息帶金額並指出要先退款', async () => {
    const fake = voidScenario({
      row: voidableRow({
        payment_records: [
          { id: 'p1', kind: 'payment', amount: 1000, method: 'cash', paid_at: '2026-03-02' },
        ],
      }),
    });
    const res = await postVoid(fake.client);
    const body = (await res.json()) as { code: string; error: string };

    expect(res.status).toBe(409);
    expect(body.code).toBe('NET_PAID_NONZERO');
    expect(body.error).toContain('1,000');
    expect(body.error).toContain('退款');
    expect(invoiceUpdates(fake)).toEqual([]);
  });

  // 裁決 A：退多了 = 還欠家長錢
  it('淨收款 < 0 也 → 409 NET_PAID_NONZERO', async () => {
    const fake = voidScenario({
      row: voidableRow({
        payment_records: [
          { id: 'p1', kind: 'payment', amount: 1000, method: 'cash', paid_at: '2026-03-02' },
          { id: 'p2', kind: 'refund', amount: 1500, method: 'cash', paid_at: '2026-03-03' },
        ],
      }),
    });
    const res = await postVoid(fake.client);

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('NET_PAID_NONZERO');
    expect(invoiceUpdates(fake)).toEqual([]);
  });

  // 裁決 D：這條只有 API 這一層，DB 沒有 trigger
  it('明細連到堂數包 → 409 HAS_SESSION_PACK，訊息說要先處理堂數包', async () => {
    const fake = voidScenario({ sessionPacks: 1 });
    const res = await postVoid(fake.client);
    const body = (await res.json()) as { code: string; error: string };

    expect(res.status).toBe(409);
    expect(body.code).toBe('HAS_SESSION_PACK');
    expect(body.error).toContain('堂數包');
    expect(invoiceUpdates(fake)).toEqual([]);

    // 查的是這張帳單的明細 id，不是整個組織
    const packQuery = fake.chains.find((c) => c.table === 'session_packs');
    expect(packQuery && fake.argsOf(packQuery, 'in')).toEqual([
      ['invoice_item_id', ['item-tuition', 'item-meal']],
    ]);
  });

  it('理由空白 → 400，什麼都不寫', async () => {
    const fake = voidScenario();
    const res = await postVoid(fake.client, '   ');

    expect(res.status).toBe(400);
    expect(invoiceUpdates(fake)).toEqual([]);
  });

  // 檢查後、寫入前被別人先作廢了：條件式 update 回 0 列
  it('update 回 0 列（競態）→ 409 ALREADY_VOIDED', async () => {
    const fake = voidScenario({ updated: [] });
    const res = await postVoid(fake.client);

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('ALREADY_VOIDED');
  });

  // 檢查後、寫入前插進一筆收款：DB trigger RAISE。回 409 而不是 500 —— 這是業務衝突
  it('DB trigger 拒絕（競態）→ 409 VOID_REJECTED', async () => {
    const fake = voidScenario({ updateError: { code: '23514', message: 'net paid 100' } });
    const res = await postVoid(fake.client);

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('VOID_REJECTED');
  });
});

describe('POST /api/invoices/{id}/void —— 成功', () => {
  it('條件式寫入三欄：只在 voided_at 仍為空時生效，理由去頭尾空白', async () => {
    const fake = voidScenario();
    const res = await postVoid(fake.client, '  開錯月  ');

    expect(res.status).toBe(200);
    const update = fake.chains.find((c) => c.table === 'invoices' && fake.has(c, 'update'));
    expect(update && fake.argsOf(update, 'update')).toEqual([
      [expect.objectContaining({ voided_by: 'u1', void_reason: '開錯月', voided_at: expect.any(String) })],
    ]);
    expect(update && fake.argsOf(update, 'is')).toEqual([['voided_at', null]]);
    expect(update && fake.argsOf(update, 'eq')).toEqual(
      expect.arrayContaining([
        ['id', VOID_ID],
        ['org_id', '00000000-0000-0000-0000-0000000000aa'],
      ]),
    );
  });

  // 裁決 B：作廢 = 收費項回到未開帳。只解**餐費** item 的章 —— 學費靠查衍生列，不用解
  it('解除這張帳單餐費明細的蓋章，只動餐費那幾個 item', async () => {
    const fake = voidScenario();
    await postVoid(fake.client);

    const release = fake.chains.find((c) => c.table === 'meal_records');
    expect(release && fake.argsOf(release, 'update')).toEqual([[{ invoice_item_id: null }]]);
    expect(release && fake.argsOf(release, 'in')).toEqual([['invoice_item_id', ['item-meal']]]);
  });

  it('沒有餐費明細就不碰 meal_records', async () => {
    const fake = voidScenario({
      row: voidableRow({
        invoice_items: [{ id: 'item-tuition', type: 'tuition', amount: 3000 }],
        payment_records: [],
      }),
    });
    await postVoid(fake.client);

    expect(fake.chains.some((c) => c.table === 'meal_records')).toBe(false);
  });

  it('寫一列稽核：resource_type invoice、action invoice.void、記下理由', async () => {
    const fake = voidScenario();
    await postVoid(fake.client);

    const audit = fake.chains.find((c) => c.table === 'audit_logs');
    expect(audit && fake.argsOf(audit, 'insert')).toEqual([
      [
        expect.objectContaining({
          resource_type: 'invoice',
          resource_id: VOID_ID,
          action: 'invoice.void',
          details: expect.objectContaining({ reason: '開錯月', mealRecordsReleased: 2 }),
        }),
      ],
    ]);
  });

  it('回傳作廢後的帳單：status void、帶作廢資訊、金額照算', async () => {
    const fake = voidScenario();
    const res = await postVoid(fake.client);
    const { data } = (await res.json()) as {
      data: { status: string; voidedAt: string; voidedBy: string; voidReason: string; total: number };
    };

    expect(data).toMatchObject({
      status: 'void',
      voidedAt: '2026-09-30T08:00:00Z',
      voidedBy: 'u1',
      voidReason: '開錯月',
      total: 3900,
    });
  });

  // 死在作廢之後、解章之前 → 重按一次要能補解章（冪等），否則餐費永遠卡在作廢單上
  it('已作廢時仍補做一次解章（重試路徑）', async () => {
    const fake = voidScenario({
      row: voidableRow({ voided_at: '2026-09-01T00:00:00Z', voided_by: 'u1', void_reason: 'x' }),
    });
    const res = await postVoid(fake.client);

    expect(res.status).toBe(409);
    const release = fake.chains.find((c) => c.table === 'meal_records');
    expect(release && fake.argsOf(release, 'in')).toEqual([['invoice_item_id', ['item-meal']]]);
  });
});

/**
 * 作廢單凍結：API 這層給看得懂的 409，DB trigger 兜底 —— **但催繳沒有 trigger**
 * （`payment_reminders` 不影響金額），所以催繳那支 API 這層是唯一一層。
 */
describe('作廢單上的寫入 → 409 INVOICE_VOIDED', () => {
  const voided = voidableRow({ voided_at: '2026-09-01T00:00:00Z', voided_by: 'u1', void_reason: 'x' });

  const cases: Array<[string, string, string, unknown]> = [
    ['新增明細', 'POST', `/${VOID_ID}/items`, { type: 'adjustment', amount: -100 }],
    ['刪除明細', 'DELETE', `/${VOID_ID}/items/00000000-0000-0000-0000-000000000077`, undefined],
    ['記收款', 'POST', `/${VOID_ID}/payments`, { amount: 100, method: 'cash' }],
    ['催繳', 'POST', `/${VOID_ID}/reminders`, { method: 'line' }],
  ];

  for (const [label, method, path, body] of cases) {
    it(`${label}：409，且沒有任何寫入`, async () => {
      const fake = chainFake((chain) => (chain.table === 'invoices' ? { data: voided } : {}));
      const res = await appWith(fake.client).request(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(res.status).toBe(409);
      expect(((await res.json()) as { code: string }).code).toBe('INVOICE_VOIDED');
      const writes = fake.chains.filter(
        (c) => fake.has(c, 'insert') || fake.has(c, 'delete') || fake.has(c, 'update'),
      );
      expect(writes.map((c) => c.table)).toEqual([]);
    });
  }
});

describe('GET /api/invoices —— 作廢單', () => {
  const rows = [
    invoiceRow({ id: '00000000-0000-0000-0000-000000000001', amount: 1000, paid: 0 }),
    { ...invoiceRow({ id: '00000000-0000-0000-0000-000000000002', amount: 1000, paid: 0 }), voided_at: '2026-09-01T00:00:00Z', voided_by: 'u1', void_reason: 'x' },
  ];

  // 裁決 C：預設列出（灰顯在前端），稽核軌跡要看得到
  it('沒帶篩選時列出作廢單，status 是 void', async () => {
    const { client } = fakeSupabase(rows as never);
    const res = await appWith(client).request('/');
    const body = (await res.json()) as { data: Array<{ id: string; status: string }> };

    expect(body.data.map((r) => r.status)).toEqual(['unpaid', 'void']);
  });

  // 作廢單的 total − netPaid 是全額，放進催繳母體就是叫行政去催一張不存在的帳單
  it('outstanding / overdue / dueWithin 都不含作廢單', async () => {
    for (const qs of ['outstanding=true', 'overdue=true', 'dueWithin=36500']) {
      const { client } = fakeSupabase(rows as never);
      const res = await appWith(client).request(`/?${qs}`);
      const body = (await res.json()) as { data: Array<{ id: string }> };
      // 斷言 id 不是 status —— 沒實作時作廢單被推導成 unpaid，斷言 status 會空轉變綠
      expect(
        body.data.map((r) => r.id),
        qs,
      ).toEqual(['00000000-0000-0000-0000-000000000001']);
    }
  });

  it('status=void 只回作廢單', async () => {
    const { client } = fakeSupabase(rows as never);
    const res = await appWith(client).request('/?status=void');
    const body = (await res.json()) as { data: Array<{ status: string }>; meta: { total: number } };

    expect(body.data.map((r) => r.status)).toEqual(['void']);
    expect(body.meta.total).toBe(1);
  });
});
