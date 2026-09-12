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

/**
 * #680：**改 `roles` 而不帶 `permissions` 會把既有權限靜默清空。**
 *
 * `PUT /api/staff/:id` 改角色時是「先刪光再重建」，而重建那一列的 permissions 取自
 * `body.permissions` —— 沒帶就是 `undefined`，`normalizeAdminPermissions` 把它變成 `[]`。
 *
 * **API 回 200、schema 上那個欄位是 `.optional()`**，所以「不帶」是合法請求，
 * 而「不帶」的語意被實作成「清空」—— 那是 PUT 與 PATCH 語意的混淆。
 * 洗掉的是**權限**，失效方向是「這個管理員突然看不到東西了」，**而沒有任何紀錄說明為什麼**。
 *
 * 使用者裁定**甲：不帶就不動**。
 *
 * 前端不受影響（已查）：`staff-form-dialog.component.ts:187` **永遠明式送
 * `permissions`**（非 admin 時送 `[]`），而 `staffService.update` 全 repo 只有那一個呼叫端。
 * 所以「從 UI 清空權限」走的是明式 `[]`，不是省略。
 */
describe('#680 PUT /api/staff/:id —— 改 roles 時沒帶 permissions 不得清空既有權限', () => {
  const ORG = '00000000-0000-0000-0000-0000000000aa';
  const TARGET_STAFF = '00000000-0000-0000-0000-0000000000d9';
  const TARGET_USER = 'target-user';
  const EXISTING: string[] = ['manage_staff', 'basic_operations'];

  /** 記下每一次 insert，測試才看得到「重建出來的那一列帶什麼權限」 */
  function fakeDb() {
    const inserted: Array<{ table: string; rows: unknown }> = [];

    const make = (table: string) => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder as never;
      Object.assign(builder, {
        select: () => chain(),
        insert: (rows: unknown) => {
          inserted.push({ table, rows });
          return chain();
        },
        update: () => chain(),
        delete: () => chain(),
        eq: () => chain(),
        in: () => chain(),
        order: () => chain(),
        limit: () => chain(),
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === 'staff'
                ? { id: TARGET_STAFF, user_id: TARGET_USER, org_id: ORG }
                : table === 'user_roles'
                  ? { role: 'admin' } // checkUserIsAdmin（問的是**請求者**）
                  : null,
            error: null,
          }),
        single: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          resolve({
            // 這一條是「既有權限」的來源：`select('permissions')` 的清單查詢
            data: table === 'user_roles' ? [{ role: 'admin', permissions: EXISTING }] : [],
            count: 0,
            error: null,
          }),
      });

      return builder;
    };

    return { inserted, from: (table: string) => make(table) };
  }

  async function put(body: unknown) {
    const db = fakeDb();
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', db);
      set('orgId', ORG);
      set('userId', 'requester-user'); // **不是 target** —— 否則被「不能改自己」擋掉
      set('roles', ['admin']);
      set('permissions', ['*']);
      set('campusScope', null);
      await next();
    });
    app.route('/', staffRoute.default as unknown as Hono);

    const res = await app.request(`/${TARGET_STAFF}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const adminRow = db.inserted
      .filter((call) => call.table === 'user_roles')
      .flatMap((call) => (Array.isArray(call.rows) ? call.rows : [call.rows]))
      .find((row) => (row as { role?: string }).role === 'admin') as
      { permissions?: string[] } | undefined;

    return { status: res.status, adminRow };
  }

  it('不帶 permissions 時沿用既有的，不是清成空陣列', async () => {
    const { status, adminRow } = await put({ roles: ['admin'] });

    expect(status).toBe(200);
    expect(adminRow?.permissions).toEqual(EXISTING);
  });

  /**
   * **反向對照 1**：明式送 `[]` 仍然要清空。
   * 這是**前端唯一的清空路徑**（`staff-form-dialog:187` 非 admin 時送 `[]`）——
   * 修法如果把「空陣列」也當成「不動」，UI 上的「取消勾選全部」就永遠生效不了。
   */
  it('明式送空陣列時照樣清空 —— 那是前端真正在用的清空路徑', async () => {
    const { status, adminRow } = await put({ roles: ['admin'], permissions: [] });

    expect(status).toBe(200);
    expect(adminRow?.permissions).toEqual([]);
  });

  /**
   * **反向對照 2**：有帶值時用帶的那個，不要被「沿用既有」蓋掉。
   */
  it('有帶 permissions 時用帶的那一份', async () => {
    const { status, adminRow } = await put({ roles: ['admin'], permissions: ['manage_roles'] });

    expect(status).toBe(200);
    expect(adminRow?.permissions).toEqual(['manage_roles']);
  });

  /**
   * **反向對照 3**：`teacher` 那一列永遠是空的，沿用邏輯不能溢出到它身上。
   */
  it('teacher 那一列的 permissions 永遠是空的', async () => {
    const db = fakeDb();
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', db);
      set('orgId', ORG);
      set('userId', 'requester-user');
      set('roles', ['admin']);
      set('permissions', ['*']);
      set('campusScope', null);
      await next();
    });
    app.route('/', staffRoute.default as unknown as Hono);

    await app.request(`/${TARGET_STAFF}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roles: ['teacher'] }),
    });

    const teacherRow = db.inserted
      .filter((call) => call.table === 'user_roles')
      .flatMap((call) => (Array.isArray(call.rows) ? call.rows : [call.rows]))
      .find((row) => (row as { role?: string }).role === 'teacher') as
      { permissions?: string[] } | undefined;

    expect(teacherRow?.permissions).toEqual([]);
  });
});
