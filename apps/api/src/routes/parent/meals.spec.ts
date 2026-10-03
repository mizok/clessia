import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import mealsRoute from './meals';

const CHILD = '00000000-0000-0000-0000-000000000001';
const SIBLING = '00000000-0000-0000-0000-000000000002';
const STRANGER = '00000000-0000-0000-0000-000000000009';

/**
 * 替身**真的實作 `eq`**（其他條件記下來不執行）—— 這支要守的就是「兄弟姊妹不混進來」
 * 與「沒訂的那天不出現」，替身不篩的話拿掉那兩個 eq 照樣綠（charter 1307 §一）。
 */
function fakeChildDb(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  return {
    calls,
    db: {
      from: (_table: string, _scopeColumn: string) => ({
        select: () => {
          const filters: Array<[string, unknown]> = [];
          const chain: any = {
            eq: (column: string, value: unknown) => {
              filters.push([column, value]);
              calls.push({ name: 'eq', args: [column, value] });
              return chain;
            },
            gte: (...args: unknown[]) => (calls.push({ name: 'gte', args }), chain),
            lte: (...args: unknown[]) => (calls.push({ name: 'lte', args }), chain),
            order: () => chain,
            then: (onfulfilled: (value: unknown) => unknown) =>
              Promise.resolve({
                data: rows.filter((row) => filters.every(([col, val]) => row[col] === val)),
                error: null,
              }).then(onfulfilled),
          };
          return chain;
        },
      }),
    },
  };
}

function appWith(roles: string[], scope: string[], db: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', roles);
    set('studentScope', scope);
    set('childDb', db);
    await next();
  });
  app.route('/', mealsRoute as unknown as Hono);
  return app;
}

const row = (studentId: string, date: string, over: Record<string, unknown> = {}) => ({
  student_id: studentId,
  meal_date: date,
  unit_price: '80',
  chargeable: true,
  ordered: true,
  invoice_item_id: null,
  note: '家長來電說孩子不吃辣',
  ...over,
});

const RANGE = 'dateFrom=2026-08-01&dateTo=2026-10-31';

describe('GET /api/me/meals（#1117）', () => {
  it('不是家長 → 403 NOT_PARENT', async () => {
    const res = await appWith(['admin'], [CHILD], fakeChildDb([]).db).request(
      `/?childId=${CHILD}&${RANGE}`,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_PARENT');
  });

  it('別人的孩子 → 403 CHILD_OUT_OF_SCOPE（指名越權回 403，不回空）', async () => {
    const res = await appWith(['parent'], [CHILD], fakeChildDb([]).db).request(
      `/?childId=${STRANGER}&${RANGE}`,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('CHILD_OUT_OF_SCOPE');
  });

  it.each([
    ['沒帶區間', '', 400],
    ['結束早於開始', 'dateFrom=2026-10-01&dateTo=2026-09-01', 'INVALID_RANGE'],
    ['超過 366 天', 'dateFrom=2025-01-01&dateTo=2026-01-02', 'RANGE_TOO_WIDE'],
  ] as const)('%s → 400', async (_n, query, expected) => {
    const res = await appWith(['parent'], [CHILD], fakeChildDb([]).db).request(
      `/?childId=${CHILD}&${query}`,
    );
    expect(res.status).toBe(400);
    if (typeof expected === 'string') {
      expect(((await res.json()) as { code: string }).code).toBe(expected);
    }
  });

  it('只回這個孩子、有訂的那幾天；不收費的金額是 0；欄位 allowlist（沒有 note／帳單 id／學生 id）', async () => {
    const { db } = fakeChildDb([
      row(CHILD, '2026-10-02'),
      row(CHILD, '2026-10-01', { chargeable: false }),
      row(CHILD, '2026-09-30', { invoice_item_id: 'inv-item-1' }),
      row(CHILD, '2026-09-29', { ordered: false }),
      row(SIBLING, '2026-10-02'),
    ]);
    const res = await appWith(['parent'], [CHILD, SIBLING], db).request(
      `/?childId=${CHILD}&${RANGE}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
      meta: { months: unknown[] };
    };
    expect(body.data).toEqual([
      { date: '2026-10-02', unitPrice: 80, chargeable: true, amount: 80, settled: false },
      { date: '2026-10-01', unitPrice: 80, chargeable: false, amount: 0, settled: false },
      { date: '2026-09-30', unitPrice: 80, chargeable: true, amount: 80, settled: true },
    ]);
    expect(body.meta.months).toEqual([
      { month: '2026-10', count: 2, totalAmount: 80 },
      { month: '2026-09', count: 1, totalAmount: 80 },
    ]);
  });

  it('日期條件照區間下到 DB', async () => {
    const fake = fakeChildDb([]);
    await appWith(['parent'], [CHILD], fake.db).request(`/?childId=${CHILD}&${RANGE}`);
    expect(fake.calls).toContainEqual({ name: 'gte', args: ['meal_date', '2026-08-01'] });
    expect(fake.calls).toContainEqual({ name: 'lte', args: ['meal_date', '2026-10-31'] });
  });
});
