import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import * as staffRoute from './staff';

describe('buildStaffSummary', () => {
  /**
   * **`adminCount + teacherCount` 大於 `total` 是刻意的，不是這個測試寫錯**。
   * `adminCount` / `teacherCount` 是**角色人次**，不是 `total`（不重複人數）的分割——
   * 同時具備 admin 與 teacher 兩個角色的人（分校主任兼授課老師，補習班很常見）
   * 會在兩邊都被算一次。
   *
   * P1-4 事故（tester 回報「101 位人員・13 管理員・89 老師，13+89=102」）就是這個
   * 不變式第一次被誤讀成 bug：**101 與 102 都是對的**，只是前端把兩種數字（人數 vs
   * 人次）畫成看起來同一種東西。`multiRoleCount` 是這次補的——把「有沒有兼」明確
   * 算出來，不是讓消費端自己去導 `adminCount + teacherCount - total` 這個不明顯的
   * 不變式（角色種類以後增加的話，那個推導方式會先壞掉）。
   *
   * 這個 3 人的 fixture 刻意包含 1 個雙角色的人，讓 `2 + 2 ≠ 3` 這個看起來像
   * bug 的斷言留在測試裡——**下一個看到這個不一致的人不該去「修好」它**。
   */
  it('adminCount 跟 teacherCount 是角色人次，同一人可能兩邊都算——不是 total 的分割', () => {
    const buildStaffSummary = (staffRoute as Record<string, unknown>)['buildStaffSummary'] as
      | ((
          rows: Array<{ user_id: string; status: string }>,
          roleInfoMap: Map<string, { roles: Array<'admin' | 'teacher'> }>,
        ) => {
          total: number;
          adminCount: number;
          teacherCount: number;
          multiRoleCount: number;
          activeCount: number;
          inactiveCount: number;
          archivedCount: number;
        })
      | undefined;

    expect(buildStaffSummary).toBeTypeOf('function');

    const summary = buildStaffSummary?.(
      [
        { user_id: 'user-1', status: 'active' },
        { user_id: 'user-2', status: 'inactive' },
        { user_id: 'user-3', status: 'archived' },
      ],
      new Map([
        ['user-1', { roles: ['admin'] }],
        ['user-2', { roles: ['teacher'] }],
        // user-3 同時是 admin 又是 teacher —— 這是 adminCount+teacherCount > total 的來源
        ['user-3', { roles: ['admin', 'teacher'] }],
      ]),
    );

    expect(summary).toEqual({
      total: 3,
      adminCount: 2,
      teacherCount: 2,
      multiRoleCount: 1,
      activeCount: 1,
      inactiveCount: 1,
      archivedCount: 1,
    });
  });
});

/**
 * 人員清單的分校範圍（#515 下半）。
 *
 * `staff.ts:527-531` 的註解：**「只管 A 校的主任不該看得到 B 校的員工名單與
 * 聯絡方式」** —— 那是這一支比其他列表更敏感的原因（洩漏的是同事的個資，
 * 不是課表）。而 `staff.spec.ts` 在此之前**只有純函式測試**。
 *
 * 這裡只能斷言查詢形狀：替身回的是固定資料，條件下對下錯回一樣的東西。
 */
describe('GET /api/staff —— 分校範圍要下到 staff_campuses 的查詢上', () => {
  function fakeSupabase() {
    const inCalls: Array<{ table: string; column: string; values: string[] }> = [];

    const make = (table: string) => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder as never;
      Object.assign(builder, {
        select: () => chain(),
        eq: () => chain(),
        or: () => chain(),
        ilike: () => chain(),
        order: () => chain(),
        range: () => chain(),
        limit: () => chain(),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        in: (column: string, values: readonly string[]) => {
          inCalls.push({ table, column, values: [...values] });
          return chain();
        },
        then: (resolve: (value: { data: unknown[]; count: number; error: null }) => unknown) =>
          resolve({ data: [], count: 0, error: null }),
      });

      return builder;
    };

    return { inCalls, from: (table: string) => make(table) };
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
      set('permissions', ['*']);
      set('campusScope', campusScope);
      await next();
    });
    app.route('/', staffRoute.default as unknown as Hono);

    const res = await app.request('/');
    expect(res.status).toBe(200);

    return supabase.inCalls;
  }

  it('受限管理員：用他的分校去撈 staff_campuses', async () => {
    const inCalls = await list(['campus-1']);

    expect(inCalls).toContainEqual({
      table: 'staff_campuses',
      column: 'campus_id',
      values: ['campus-1'],
    });
  });

  it('不受分校限制時不下這個條件（確認上一條不是無腦通過）', async () => {
    const inCalls = await list(null);

    expect(inCalls.some((call) => call.table === 'staff_campuses')).toBe(false);
  });
});
