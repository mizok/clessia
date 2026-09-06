import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import * as campusesRoute from './campuses';

describe('buildCampusSummary', () => {
  it('builds global campus summary counts from filtered rows', () => {
    const buildCampusSummary = (campusesRoute as Record<string, unknown>)['buildCampusSummary'] as
      | ((
          rows: Array<{ is_active: boolean }>,
          total: number,
        ) => {
          total: number;
          activeCount: number;
          inactiveCount: number;
        })
      | undefined;

    expect(buildCampusSummary).toBeTypeOf('function');

    const summary = buildCampusSummary?.(
      [{ is_active: true }, { is_active: false }, { is_active: true }],
      3,
    );

    expect(summary).toEqual({
      total: 3,
      activeCount: 2,
      inactiveCount: 1,
    });
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
