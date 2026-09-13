import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import * as campusesRoute from './campuses';

describe('buildCampusSummary', () => {
  it('builds global campus summary counts from filtered rows', () => {
    const buildCampusSummary = (campusesRoute as Record<string, unknown>)['buildCampusSummary'] as
      | ((rows: Array<{ is_active: boolean }>) => {
          total: number;
          activeCount: number;
          inactiveCount: number;
        })
      | undefined;

    expect(buildCampusSummary).toBeTypeOf('function');

    const summary = buildCampusSummary?.([
      { is_active: true },
      { is_active: false },
      { is_active: true },
    ]);

    expect(summary).toEqual({
      total: 3,
      activeCount: 2,
      inactiveCount: 1,
    });
  });

  /**
   * #751：三個數字要對得起來。
   *
   * `activeCount` / `inactiveCount` 一直是從**未套 `isActive` 篩選**的 rows 算的
   * （`campuses.ts` 那行註解：「summary 不套用 isActive filter，永遠反映全機構的
   * 真實總數」），但 `total` 原本是主清單查詢的 `count`，那一支**有**套篩選。
   * 於是隱藏停用分校時畫面印出「12 個分校 / 12 啟用中 / 1 已停用」—— 12 ≠ 12+1。
   *
   * **上面那條既有測試沒抓到，是因為它給的 rows.length 與 total 剛好相等。**
   * 這一條刻意讓兩者不一致。
   */
  it('#751 總數含停用 —— 三個數字必須自洽，不受清單篩選影響', () => {
    const buildCampusSummary = (campusesRoute as Record<string, unknown>)['buildCampusSummary'] as (
      rows: Array<{ is_active: boolean }>,
    ) => { total: number; activeCount: number; inactiveCount: number };

    // 全機構 3 間（2 啟用 1 停用），而清單當下只顯示啟用的那 2 間
    const summary = buildCampusSummary([
      { is_active: true },
      { is_active: false },
      { is_active: true },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.activeCount).toBe(2);
    expect(summary.inactiveCount).toBe(1);
    expect(summary.total).toBe(summary.activeCount + summary.inactiveCount);
  });
});

/**
 * 分校範圍要套在**清單與統計兩支查詢上**（#515 下半）。
 *
 * `campuses.ts:156` 與 `:183` 各套一次 `applyCampusFilter(…, 'id', campusScope)`，
 * 而 `:182` 的註解寫著理由：**「統計要跟清單同範圍，否則『共 5 間』配上 2 列」**。
 *
 * **所以這裡釘的是次數不是「有出現過」** —— 兩處產生同樣形狀的呼叫，
 * 只斷言「有出現」的話，其中一處掉了另一處仍然滿足（attendance 那支實測過：
 * 拿掉其中一處，`toContainEqual` 版本照樣綠）。
 *
 * 這條只能斷言查詢形狀：替身回的是固定資料，條件下對下錯回一樣的東西。
 */
describe('GET /api/campuses —— 分校範圍要套在清單與統計兩支查詢上', () => {
  function fakeSupabase() {
    const inCalls: Array<{ column: string; values: string[] }> = [];
    const builder: Record<string, unknown> = {};
    const chain = () => builder as never;

    Object.assign(builder, {
      select: () => chain(),
      eq: () => chain(),
      ilike: () => chain(),
      order: () => chain(),
      range: () => chain(),
      in: (column: string, values: readonly string[]) => {
        inCalls.push({ column, values: [...values] });
        return chain();
      },
      then: (resolve: (value: { data: unknown[]; count: number; error: null }) => unknown) =>
        resolve({ data: [], count: 0, error: null }),
    });

    return { inCalls, from: () => builder };
  }

  async function list(campusScope: readonly string[] | null) {
    const supabase = fakeSupabase();
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', supabase);
      set('orgId', '00000000-0000-0000-0000-0000000000aa');
      set('userId', 'user-1');
      set('roles', ['admin']);
      set('campusScope', campusScope);
      await next();
    });
    app.route('/', campusesRoute.default as unknown as Hono);

    const res = await app.request('/');
    expect(res.status).toBe(200);

    return supabase.inCalls;
  }

  it('受限管理員：清單與統計各帶一次他的分校清單', async () => {
    const inCalls = await list(['campus-1']);

    const scoped = inCalls.filter((call) => call.column === 'id');
    expect(scoped).toHaveLength(2);
    for (const call of scoped) {
      expect(call.values).toEqual(['campus-1']);
    }
  });

  it('不受分校限制時兩支都不下這個條件（確認上一條不是無腦通過）', async () => {
    const inCalls = await list(null);

    expect(inCalls.some((call) => call.column === 'id')).toBe(false);
  });
});

/**
 * **#837：分校的稽核 `details` 全是 `{}`** —— `update` 只留改完後的名字，
 * 「這一筆改了什麼」完全查不到（labor-8 實按比對六種 `resource_type` 時發現）。
 *
 * 分校是 13 個實例的實體、改名／停用是行政上會被追問的動作 ——
 * 稽核答得出誰／何時、答不出改成什麼，等於只有一半。
 *
 * ⚠️ **工單說「五顆都補」，而 API 只有三個端點**：UI 的停用／啟用走的是
 * `PUT /{id}`（改 `is_active`），所以那五次操作在稽核上是
 * `create` / `update` ×3 / `delete`。三個端點補完就涵蓋五顆。
 */
describe('campuses 的稽核 details（#837）', () => {
  const ORG = '00000000-0000-0000-0000-0000000000aa';
  const CAMPUS = '00000000-0000-0000-0000-0000000000c1';
  const BEFORE = {
    id: CAMPUS,
    name: '中正分校',
    address: '舊地址',
    phone: null,
    is_active: true,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };

  function fakeDb() {
    const auditRows: Array<Record<string, unknown>> = [];
    // **update 之前與之後的 `single()` 要回不同的東西** ——
    // 同一個替身要同時扮演「改動前的那一列」與「改完回傳的那一列」
    let updated = false;
    let after: Record<string, unknown> = BEFORE;

    const make = (table: string) => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder as never;
      Object.assign(builder, {
        select: () => chain(),
        eq: () => chain(),
        in: () => chain(),
        order: () => chain(),
        limit: () => chain(),
        insert: (rows: Record<string, unknown>) => {
          if (table === 'audit_logs') {
            auditRows.push(rows);
            return Promise.resolve({ error: null });
          }
          return chain();
        },
        update: (payload: Record<string, unknown>) => {
          updated = true;
          after = { ...BEFORE, ...payload };
          return chain();
        },
        delete: () => chain(),
        single: () =>
          Promise.resolve({
            data:
              table === 'campuses'
                ? updated
                  ? after
                  : BEFORE
                : table === 'profiles'
                  ? null
                  : { id: 'new-campus', name: '新分校', is_active: true },
            error: null,
          }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: [], count: 0, error: null }),
      });

      return builder;
    };

    return { auditRows, from: (table: string) => make(table) };
  }

  async function request(path: string, method: string, body?: unknown) {
    const db = fakeDb();
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', db);
      set('orgId', ORG);
      set('userId', 'user-1');
      set('roles', ['admin']);
      set('permissions', ['*']);
      set('campusScope', null);
      await next();
    });
    app.route('/', campusesRoute.default as unknown as Hono);

    const res = await app.request(path, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    });
    await Promise.resolve();
    await Promise.resolve();

    return { status: res.status, auditRows: db.auditRows };
  }

  it('改名：details 記得下 from 與 to，只含這次送出的欄位', async () => {
    const { status, auditRows } = await request(`/${CAMPUS}`, 'PUT', { name: '中正旗艦校' });

    expect(status).toBe(200);
    const row = auditRows.find((r) => r['action'] === 'update');
    expect(row?.['details']).toEqual({
      fields: ['name'],
      from: { name: '中正分校' },
      to: { name: '中正旗艦校' },
    });
  });

  // 停用走的是同一支 PUT —— 所以它也要記得下 is_active 的 before
  it('停用：details 的 from 記得下原本是啟用的', async () => {
    const { auditRows } = await request(`/${CAMPUS}`, 'PUT', { isActive: false });

    const row = auditRows.find((r) => r['action'] === 'update');
    expect(row?.['details']).toEqual({
      fields: ['is_active'],
      from: { is_active: true },
      to: { is_active: false },
    });
  });

  it('刪除：details 是刪前快照，不含 created_at 這類不是人改的欄位', async () => {
    const { auditRows } = await request(`/${CAMPUS}`, 'DELETE');

    const row = auditRows.find((r) => r['action'] === 'delete');
    expect(row?.['details']).toEqual({
      name: '中正分校',
      address: '舊地址',
      phone: null,
      is_active: true,
    });
    expect(row?.['details']).not.toHaveProperty('created_at');
  });
});
