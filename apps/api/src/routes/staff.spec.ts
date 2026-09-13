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

/**
 * **#833：刪除人員之後 `ba_user` 變成孤兒，那個 email 永久不能再用。**
 *
 * `DELETE /api/staff/{id}` 刪掉 `staff` 與 `user_roles`，但 `ba_user` 留著 ——
 * 而 `ba_user.email` 有 UNIQUE 索引、`ba_*` 表可讀不可寫（憲法 c2），
 * 所以 app 裡沒有任何東西清得掉它。
 *
 * **工單原本指定「走 Better Auth 的 admin API 刪使用者」，那條路在這個專案走不通**：
 * `auth.api.removeUser` 有 `use: [adminMiddleware]`（`createUser` 沒有），
 * 它的 handler 第一件事是 `hasPermission({ role: session.user.role, permissions: { user: ['delete'] } })`，
 * 而這個專案 `ba_user.role` 全部是 `DEFAULT 'user'`（`20260223000002_ba_user_role.sql`
 * 的註解自己寫「separate from our app-level user_roles table」）、`auth.ts` 是零選項的
 * `adminPlugin()` —— **沒有任何人的 Better Auth role 是 admin，所以必定 403**。
 * 既有的 `rollbackCreatedUser()` 也呼叫它，而它的 catch 訊息逐字寫著
 * 「rollback 失敗，孤兒 ba_user=」—— **那個 rollback 從來沒成功過，它是孤兒的第二個來源。**
 *
 * 所以裁定走 C：**止血（DELETE 明確拒絕）＋ 解藥（建立時接管孤兒）**。
 */
describe('#833 人員刪除與孤兒 ba_user', () => {
  const ORG = '00000000-0000-0000-0000-0000000000aa';
  const TARGET_STAFF = '00000000-0000-0000-0000-0000000000d9';
  const ORPHAN_USER = 'orphan-user-id';

  /**
   * `orphanRelations` 決定那個既有 `ba_user` 掛著什麼：
   * 三張表都空＝完全脫離的孤兒（可接管）；任何一張有東西＝屬於別人（不可接管）。
   */
  function fakeDb(options: {
    existingEmailUserId?: string | null;
    orphanRelations?: { staff?: unknown[]; parents?: unknown[]; userRoles?: unknown[] };
  }) {
    const inserted: Array<{ table: string; rows: unknown }> = [];
    const deleted: string[] = [];
    const auditRows: Array<Record<string, unknown>> = [];
    const rel = options.orphanRelations ?? {};

    const make = (table: string) => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder as never;
      Object.assign(builder, {
        select: () => chain(),
        insert: (rows: Record<string, unknown>) => {
          if (table === 'audit_logs') {
            auditRows.push(rows);
            return Promise.resolve({ error: null });
          }
          inserted.push({ table, rows });
          return chain();
        },
        update: () => chain(),
        delete: () => {
          deleted.push(table);
          return chain();
        },
        eq: () => chain(),
        in: () => chain(),
        order: () => chain(),
        limit: () => chain(),
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === 'staff'
                ? { id: TARGET_STAFF, user_id: 'some-user', org_id: ORG }
                : table === 'user_roles'
                  ? { role: 'admin' } // checkUserIsAdmin（問的是請求者）
                  : table === 'ba_user'
                    ? options.existingEmailUserId
                      ? { id: options.existingEmailUserId }
                      : null
                    : table === 'profiles'
                      ? null // logAudit 會查它
                      : null,
            error: null,
          }),
        single: () =>
          Promise.resolve({
            data: table === 'staff' ? { id: TARGET_STAFF, user_id: ORPHAN_USER } : null,
            error: null,
          }),
        then: (resolve: (value: unknown) => unknown) =>
          resolve({
            data:
              table === 'staff'
                ? (rel.staff ?? [])
                : table === 'parents'
                  ? (rel.parents ?? [])
                  : table === 'user_roles'
                    ? (rel.userRoles ?? [])
                    : // `validateCampusIdsInOrg` 比對「查回來的筆數 === 送進來的筆數」，
                      // 所以這裡要回一筆，否則 handler 在 INVALID_CAMPUSES 就 return 了
                      table === 'campuses'
                      ? [{ id: ORG }]
                      : [],
            count: 0,
            error: null,
          }),
      });

      return builder;
    };

    return { inserted, deleted, auditRows, from: (table: string) => make(table) };
  }

  function appWith(db: ReturnType<typeof fakeDb>) {
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

    return app;
  }

  describe('解藥：建立時接管完全脫離的孤兒 ba_user', () => {
    // `campusIds` 的 schema 是 `.min(1)` —— 空陣列會被 zod 擋在 handler 之前，
    // 於是測到的是驗證器不是接管邏輯（這一輪第三次踩到 fixture 不合 schema）
    const body = {
      email: 'qa-758-r2@demo.clessia.app',
      displayName: '回鍋老師',
      // 用 admin 不用 teacher：`teacher` 另有「至少一個教學科目」的前置驗證，
      // 而這組測的是接管邏輯不是那條規則
      roles: ['admin'],
      permissions: [],
      campusIds: [ORG],
    };

    async function post(db: ReturnType<typeof fakeDb>) {
      const res = await appWith(db).request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      // logAudit 是 fire-and-forget
      await Promise.resolve();
      await Promise.resolve();

      return res;
    }

    it('三張表都空 → 接管那一列，不再回 409', async () => {
      const db = fakeDb({ existingEmailUserId: ORPHAN_USER, orphanRelations: {} });

      const res = await post(db);

      expect(res.status).not.toBe(409);
      // 接管＝用既有的 user id 建 staff，而不是建一個新的 ba_user
      const staffInsert = db.inserted.find((call) => call.table === 'staff');
      expect((staffInsert?.rows as { user_id?: string })?.user_id).toBe(ORPHAN_USER);
    });

    it('接管時寫一筆 audit，details 說得出這是接管不是新建', async () => {
      const db = fakeDb({ existingEmailUserId: ORPHAN_USER, orphanRelations: {} });

      await post(db);

      const created = db.auditRows.find((row) => row['action'] === 'create');
      expect(created).toBeDefined();
      expect(JSON.stringify(created?.['details'])).toContain('reclaimed_orphan_ba_user');
    });

    /**
     * **三個反向對照，一張表一個** —— 少查任何一張的後果都是「把別人的帳號接過來」，
     * 而那在畫面上看起來完全正常（名字會被改成新人員的名字）。
     */
    it('掛著 staff（在職或已封存的人員）→ 不接管，照舊 409', async () => {
      const db = fakeDb({
        existingEmailUserId: ORPHAN_USER,
        orphanRelations: { staff: [{ id: 'other-staff' }] },
      });

      expect((await post(db)).status).toBe(409);
    });

    it('掛著 parents（家長帳號）→ 不接管，照舊 409', async () => {
      const db = fakeDb({
        existingEmailUserId: ORPHAN_USER,
        orphanRelations: { parents: [{ id: 'some-parent' }] },
      });

      expect((await post(db)).status).toBe(409);
    });

    it('掛著 user_roles（還有角色）→ 不接管，照舊 409', async () => {
      const db = fakeDb({
        existingEmailUserId: ORPHAN_USER,
        orphanRelations: { userRoles: [{ role: 'teacher' }] },
      });

      expect((await post(db)).status).toBe(409);
    });
  });

  describe('止血：DELETE 明確拒絕，不製造新的孤兒', () => {
    it('回 409 並說得出該走哪條路，而不是 success:true', async () => {
      const db = fakeDb({});
      const res = await appWith(db).request(`/${TARGET_STAFF}`, { method: 'DELETE' });

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string; code: string };
      expect(body.error).toContain('封存');
    });

    // **關鍵的那一半**：擋下來之後不能還是把 staff / user_roles 刪掉了
    it('被拒絕時什麼都沒刪', async () => {
      const db = fakeDb({});
      await appWith(db).request(`/${TARGET_STAFF}`, { method: 'DELETE' });

      expect(db.deleted).not.toContain('staff');
      expect(db.deleted).not.toContain('user_roles');
    });
  });
});
