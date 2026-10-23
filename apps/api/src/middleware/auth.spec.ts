import { Hono } from 'hono';
import { clearIdentityCache } from '../lib/identity-cache';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { authMiddleware, campusRequestGuard, requireAdminPermission, requireRoles } from './auth';
import type { AppEnv } from '../index';
import { getCampusScope } from '../lib/campus-scope';

const getSession = vi.fn();
const fromMock = vi.fn();

/**
 * 讓替身的查詢結果也能再接 `.eq()`：staff／parents 的身分查詢是 `.eq('user_id').eq('org_id')`（#1603）。
 * 這個 helper 不過濾 —— 要驗 org 過濾的那條測試自己記下 eq 參數。
 */
function eqChain<T extends object>(result: T): T & { eq: () => T } {
  return Object.assign(result, { eq: () => eqChain(result) });
}

/** Hyperdrive A：身分查詢走 SQL 用的 pool。預設 undefined ＝ 沒有 pool，走 REST（既有測試都是這條） */
let poolForTest:
  { query: ReturnType<typeof vi.fn>; connect?: ReturnType<typeof vi.fn> } | undefined;

vi.mock('../lib/get-auth', () => ({
  getAuth: () => ({
    api: { getSession: (...args: unknown[]) => getSession(...args) },
    pool: poolForTest,
  }),
}));

vi.mock('../lib/supabase', () => ({
  createServiceClientFromEnv: () => ({ from: (table: string) => fromMock(table) }),
}));

/**
 * 這組測試守的是「忘記宣告時該拒絕」。
 *
 * 這個洞當初長出來的方式就是：新增 route 時沒有人想到要限制角色，而預設是全開。
 * 見 kb/wiki/architecture/role-authorization.md
 */
function appWithRoles(roles: string[] | undefined, allowed: string[]) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set('roles', roles);
    await next();
  });
  app.use('*', requireRoles(...allowed));
  app.get('/', (c) => c.json({ ok: true }));
  return app;
}

describe('requireRoles', () => {
  it('角色在允許清單裡就放行', async () => {
    const res = await appWithRoles(['teacher'], ['admin', 'teacher']).request('/');

    expect(res.status).toBe(200);
  });

  it('角色不在允許清單裡回 403', async () => {
    const res = await appWithRoles(['parent'], ['admin']).request('/');

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  it('多重角色只要命中一個就放行', async () => {
    const res = await appWithRoles(['parent', 'admin'], ['admin']).request('/');

    expect(res.status).toBe(200);
  });

  // 沒有任何角色的帳號（例如只建了 ba_user 沒建 user_roles）不該因此變成通行證
  it('沒有角色時拒絕', async () => {
    expect((await appWithRoles([], ['admin']).request('/')).status).toBe(403);
  });

  it('context 裡根本沒有 roles 時拒絕，而不是當成全開', async () => {
    expect((await appWithRoles(undefined, ['admin']).request('/')).status).toBe(403);
  });

  // 允許清單空的通常代表呼叫端寫錯了，這時放行是最糟的失敗方式
  it('允許清單是空的就全部拒絕', async () => {
    expect((await appWithRoles(['admin'], []).request('/')).status).toBe(403);
  });
});

/**
 * 細部權限的准入。**在這支之前，API 完全沒有 permission 層** —— `permissions` 只經由
 * `/api/me` 回給前端，由 web 的 `permissionGuard` 擋。那是畫面控制不是授權：
 * 直接打 API 就繞過去了。金流是第一個真的需要它的地方（`manage_finance`）。
 *
 * 一律 fail-closed，理由同 requireRoles：授權的洞幾乎都長在「不確定的時候放行」上。
 */
function appWithPermissions(
  permissions: string[] | undefined,
  required: string,
  roles: string[] | undefined = ['admin'],
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set;
    set('roles', roles);
    set('permissions', permissions);
    await next();
  });
  app.use('*', requireAdminPermission(required));
  app.get('/', (c) => c.json({ ok: true }));
  return app;
}

describe('requireAdminPermission', () => {
  it('有這個權限就放行', async () => {
    expect(
      (await appWithPermissions(['manage_finance'], 'manage_finance').request('/')).status,
    ).toBe(200);
  });

  // `*` 是萬用權限，bootstrap 建的第一個管理員拿的就是它（`user_roles.permissions = ["*"]`）。
  // web 的 `auth.hasPermission()` 也是這個規則 —— 兩邊不一致的話會出現「畫面看得到、
  // API 打不進去」。
  it('`*` 通吃', async () => {
    expect((await appWithPermissions(['*'], 'manage_finance').request('/')).status).toBe(200);
  });

  it('沒有這個權限回 403', async () => {
    const res = await appWithPermissions(['manage_staff'], 'manage_finance').request('/');

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  it('權限清單是空的就拒絕', async () => {
    expect((await appWithPermissions([], 'manage_finance').request('/')).status).toBe(403);
  });

  // 這條最重要：middleware 忘了把 permissions 放進 context 時，不能變成全開
  it('context 裡根本沒有 permissions 時拒絕，而不是當成全開', async () => {
    expect((await appWithPermissions(undefined, 'manage_finance').request('/')).status).toBe(403);
  });

  // 老師的 permissions 永遠是空陣列（normalizeAdminPermissions 只對 admin 回非空）。
  // 純粹的 permission 檢查會把 `['admin','teacher']` 那些 mount 上的老師全部鎖在門外 ——
  // 這正是把細部權限推廣到金流以外時最容易踩的坑。
  it('老師不受細部權限約束，交給角色層與 teacher-scope', async () => {
    expect((await appWithPermissions([], 'manage_students', ['teacher']).request('/')).status).toBe(
      200,
    );
  });

  // ponytail 的已知天花板：同時是管理員又是老師的人，缺權限時一律拒絕，
  // 不會偷偷降級成老師身分。修法是補權限，不是讓授權在角色之間漂移。
  it('同時有 admin 與 teacher 時，缺權限仍然拒絕', async () => {
    expect(
      (await appWithPermissions([], 'manage_students', ['admin', 'teacher']).request('/')).status,
    ).toBe(403);
  });

  it('沒有任何角色時拒絕', async () => {
    expect((await appWithPermissions(['*'], 'manage_finance', []).request('/')).status).toBe(403);
  });

  // context 完全沒有 roles（有人在 authMiddleware 之外掛了它）也不能變成全開。
  // 不用上面那支 helper —— 它的預設參數會把顯式傳入的 undefined 換成 ['admin']。
  it('context 裡根本沒有 roles 時拒絕', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      (c as unknown as { set: (k: string, v: unknown) => void }).set('permissions', ['*']);
      await next();
    });
    app.use('*', requireAdminPermission('manage_finance'));
    app.get('/', (c) => c.json({ ok: true }));

    expect((await app.request('/')).status).toBe(403);
  });
});

/**
 * `authMiddleware` 的三支身分查詢任何一支失敗就回 500。
 *
 * **那個 500 原本不留任何線索** —— 三個 error 物件讀完就丟。而這是每個受保護請求都會
 * 跑的路徑，所以連線層抖一下就長成一個查不出來的 500（正式站實際發生過：
 * 新增課程第一次 500、第二次 201，而課程沒有重複，證明炸在 handler 之前）。
 *
 * 這組測試守的是「失敗的原因有被印出來」，而且**印得出是哪一支查詢** ——
 * 只印「查詢失敗」的話，下一個人還是只能猜。
 */
describe('authMiddleware 的身分查詢失敗', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getSession.mockReset();
    fromMock.mockReset();
  });

  function appWithQueryResults(results: Record<string, { data: unknown; error: unknown }>) {
    getSession.mockResolvedValue({ user: { id: 'user-1', orgId: 'org-1' } });
    fromMock.mockImplementation((table: string) => ({
      select: () => ({
        eq: () => {
          const result = results[table] ?? { data: [], error: null };
          // 這個替身同時要服務兩種呼叫形狀：`.eq()` 直接 await（角色/身分查詢），
          // 以及 `.eq().maybeSingle()`（`logAudit` 查 profiles）。
          // 少了 maybeSingle，稽核會在它自己的 try/catch 裡靜默失敗
          return eqChain(
            Object.assign(Promise.resolve(result), {
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          );
        },
      }),
      insert: () => Promise.resolve({ error: null }),
    }));

    const app = new Hono();
    app.use('*', authMiddleware);
    app.get('/', (c) => c.json({ ok: true }));
    return app;
  }

  it('查詢成功時照常放行', async () => {
    const app = appWithQueryResults({
      user_roles: { data: [{ role: 'admin', permissions: [] }], error: null },
    });

    const res = await app.request('/');

    expect(res.status).toBe(200);
  });

  it('查詢失敗時回 500，並印出是哪一支、錯在什麼', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = appWithQueryResults({
      staff: { data: null, error: { message: 'connection terminated unexpectedly' } },
    });

    const res = await app.request('/');

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ code: 'SERVER_ERROR' });

    const logged = consoleError.mock.calls.map((call) => String(call[0])).join('\n');
    // 「哪一支」與「錯在什麼」都要在 —— 少一個就還是得猜
    expect(logged).toContain('staff');
    expect(logged).toContain('connection terminated unexpectedly');
  });

  it('多支同時失敗時每一支都印出來', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = appWithQueryResults({
      user_roles: { data: null, error: { message: 'roles boom' } },
      parents: { data: null, error: { message: 'parents boom' } },
    });

    await app.request('/');

    const logged = consoleError.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('user_roles');
    expect(logged).toContain('parents');
  });
});

/**
 * `studentScope` 的 null vs 空陣列 —— 設計文件點名「這層最容易寫錯的地方」：
 * 不是家長 → `null`（不受限）；是家長但沒綁小孩 → `[]`（什麼都看不到）。
 * 把 `[]` 當成 `null` 處理，等於讓沒綁小孩的家長看到全部。
 * 見 kb/wiki/architecture/parent-data-scope.md。
 */
describe('authMiddleware 的 studentScope', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getSession.mockReset();
    fromMock.mockReset();
  });

  function appReturningScope(results: Record<string, { data: unknown; error: unknown }>) {
    getSession.mockResolvedValue({ user: { id: 'user-1', orgId: 'org-1' } });
    fromMock.mockImplementation((table: string) => ({
      select: () => ({
        eq: () => {
          const result = results[table] ?? { data: [], error: null };
          return eqChain(
            Object.assign(Promise.resolve(result), {
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          );
        },
      }),
      insert: () => Promise.resolve({ error: null }),
    }));

    const app = new Hono<AppEnv>();
    app.use('*', authMiddleware);
    app.get('/', (c) => c.json({ studentScope: c.get('studentScope') }));
    return app;
  }

  it('不是家長身分時 studentScope 是 null（不受限）', async () => {
    const app = appReturningScope({
      user_roles: { data: [{ role: 'teacher', permissions: [] }], error: null },
    });

    expect(await (await app.request('/')).json()).toEqual({ studentScope: null });
  });

  it('是家長但沒有任何 parent_student_relations 時 studentScope 是空陣列，不是 null', async () => {
    const app = appReturningScope({
      user_roles: { data: [{ role: 'parent', permissions: [] }], error: null },
      parents: { data: [{ status: 'active', parent_student_relations: [] }], error: null },
    });

    expect(await (await app.request('/')).json()).toEqual({ studentScope: [] });
  });

  it('是家長且有關聯學生時 studentScope 是那些 student id', async () => {
    const app = appReturningScope({
      user_roles: { data: [{ role: 'parent', permissions: [] }], error: null },
      parents: {
        data: [
          {
            status: 'active',
            parent_student_relations: [{ student_id: 's1' }, { student_id: 's2' }],
          },
        ],
        error: null,
      },
    });

    expect(await (await app.request('/')).json()).toEqual({ studentScope: ['s1', 's2'] });
  });

  // #1970 審核席 @c299a595：childDb 的寫入能力（createLeave）要拿得到 auth.pool。
  // 單元與契約都自己組 childDb，不經過這裡 —— 這裡漏傳 pool 的話，正式環境的家長請假一律 500 而沒有測試會紅
  it('家長身分＋auth.pool 有值 → childDb.createLeave 真的用到那個 pool', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const connect = vi.fn().mockRejectedValue(new Error('reached the pool'));
    // 身分查詢的 SQL 失敗 → 照既有規則走 REST；這裡只在乎 childDb 有沒有接到 pool
    poolForTest = { query: vi.fn().mockRejectedValue(new Error('no sql identity')), connect };
    try {
      clearIdentityCache();
      getSession.mockResolvedValue({ user: { id: 'user-1', orgId: 'org-1' } });
      fromMock.mockImplementation((table: string) => ({
        select: () => ({
          eq: () => {
            const result =
              table === 'user_roles'
                ? { data: [{ role: 'parent', permissions: [] }], error: null }
                : table === 'parents'
                  ? {
                      data: [
                        { status: 'active', parent_student_relations: [{ student_id: 's1' }] },
                      ],
                      error: null,
                    }
                  : { data: [], error: null };
            return eqChain(
              Object.assign(Promise.resolve(result), {
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            );
          },
        }),
        insert: () => Promise.resolve({ error: null }),
      }));
      const app = new Hono<AppEnv>();
      app.use('*', authMiddleware);
      app.get('/', async (c) =>
        c.json(
          await c.get('childDb').createLeave({
            studentId: 's1',
            window: {
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              startTime: null,
              endTime: null,
              boundSessions: [],
            },
            reason: null,
            userId: 'user-1',
          }),
        ),
      );
      const res = await app.request('/');
      expect(res.status).toBe(200);
      // 替身 pool 的 connect 丟錯 → createLeave 回 failed；重點是它**走到了** pool
      expect(connect).toHaveBeenCalledTimes(1);
    } finally {
      poolForTest = undefined;
    }
  });
});

/**
 * 分校範圍的「指名」這一半。**回 403 不是空清單** —— 默默回空會讓越權嘗試
 * 看起來像「那個分校那天沒有人」，越權的人不知道自己被擋，被越權的機構
 * 也不會發現有人在試。
 */
function appWithCampusScope(scope: readonly string[] | null) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set('campusScope', scope);
    await next();
  });
  app.use('*', campusRequestGuard);
  app.get('/x', (c) => c.json({ ok: true }));
  return app;
}

describe('campusRequestGuard', () => {
  it('不受分校限制的人指定哪個都行', async () => {
    expect((await appWithCampusScope(null).request('/x?campusId=z')).status).toBe(200);
  });

  it('沒有指定分校時放行', async () => {
    expect((await appWithCampusScope(['a']).request('/x')).status).toBe(200);
  });

  it('指定範圍內的分校放行', async () => {
    expect((await appWithCampusScope(['a', 'b']).request('/x?campusId=b')).status).toBe(200);
  });

  it('指定範圍外的分校回 403', async () => {
    const res = await appWithCampusScope(['a']).request('/x?campusId=b');

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  // 複數版是逗號分隔 —— 夾帶一個範圍外的就整支擋掉，不是過濾掉那一個
  it('campusIds 清單裡夾帶範圍外的分校也擋', async () => {
    expect((await appWithCampusScope(['a']).request('/x?campusIds=a,b')).status).toBe(403);
  });

  it('campusIds 全部在範圍內就放行', async () => {
    expect((await appWithCampusScope(['a', 'b']).request('/x?campusIds=a,b')).status).toBe(200);
  });

  it('一個分校都沒被指派時，指名任何分校都擋', async () => {
    expect((await appWithCampusScope([]).request('/x?campusId=a')).status).toBe(403);
  });
});

/**
 * 身分三查的快取（#1595 P1b）。**撤銷的最長延遲是 IDENTITY_TTL_MS（30 秒）**：
 * TTL 內可能還吃舊的結果（明文允許），**超過 TTL 必須拒絕**。
 * 角色、權限、帳號停用三種撤銷各守一條 —— 它們走的是同一份快取，但被拿來做的判斷不同。
 */
describe('authMiddleware 的身分快取：撤銷最遲 30 秒生效', () => {
  afterEach(() => {
    vi.useRealTimers();
    getSession.mockReset();
    fromMock.mockReset();
  });

  // 上限寫死在這裡、不引用 IDENTITY_TTL_MS：有人把 TTL 調長時這組測試要紅，
  // 而不是跟著常數一起變長。要改上限就是改政策，兩邊一起改並更新 KB。
  const REVOCATION_LIMIT_MS = 30_000;

  /** `results` 是可變的：測試中途改它，模擬管理員在 DB 撤銷。 */
  function appWithMutableIdentity(results: Record<string, { data: unknown; error: unknown }>) {
    getSession.mockResolvedValue({ user: { id: 'user-1', orgId: 'org-1' } });
    fromMock.mockImplementation((table: string) => ({
      select: () => ({
        eq: () => eqChain(Promise.resolve(results[table] ?? { data: [], error: null })),
      }),
    }));

    const app = new Hono<AppEnv>();
    app.use('*', authMiddleware);
    app.get('/admin-only', requireRoles('admin'), (c) => c.json({ ok: true }));
    app.get('/finance', requireAdminPermission('manage_finance'), (c) => c.json({ ok: true }));
    return app;
  }

  it('TTL 內重複請求不重查身分表', async () => {
    vi.useFakeTimers();
    const app = appWithMutableIdentity({
      user_roles: { data: [{ role: 'admin', permissions: [] }], error: null },
    });

    await app.request('/admin-only');
    const callsAfterFirst = fromMock.mock.calls.length;
    await app.request('/admin-only');

    expect(callsAfterFirst).toBe(3);
    expect(fromMock.mock.calls.length).toBe(3);
  });

  it('撤銷角色：超過 TTL 後拒絕', async () => {
    vi.useFakeTimers();
    const results = {
      user_roles: { data: [{ role: 'admin', permissions: [] }] as unknown, error: null },
    };
    const app = appWithMutableIdentity(results);
    expect((await app.request('/admin-only')).status).toBe(200);

    results.user_roles = { data: [{ role: 'teacher', permissions: [] }], error: null };
    vi.advanceTimersByTime(REVOCATION_LIMIT_MS + 1);

    expect((await app.request('/admin-only')).status).toBe(403);
  });

  it('拔權限：超過 TTL 後拒絕', async () => {
    vi.useFakeTimers();
    const results = {
      user_roles: {
        data: [{ role: 'admin', permissions: ['manage_finance'] }] as unknown,
        error: null,
      },
    };
    const app = appWithMutableIdentity(results);
    expect((await app.request('/finance')).status).toBe(200);

    results.user_roles = { data: [{ role: 'admin', permissions: [] }], error: null };
    vi.advanceTimersByTime(REVOCATION_LIMIT_MS + 1);

    expect((await app.request('/finance')).status).toBe(403);
  });

  it('停用帳號：超過 TTL 後拒絕', async () => {
    vi.useFakeTimers();
    const results: Record<string, { data: unknown; error: unknown }> = {
      user_roles: { data: [{ role: 'admin', permissions: [] }], error: null },
      staff: { data: [{ status: 'active', staff_campuses: [] }], error: null },
    };
    const app = appWithMutableIdentity(results);
    expect((await app.request('/admin-only')).status).toBe(200);

    results['staff'] = { data: [{ status: 'inactive', staff_campuses: [] }], error: null };
    vi.advanceTimersByTime(REVOCATION_LIMIT_MS + 1);

    const res = await app.request('/admin-only');
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: 'ACCOUNT_DISABLED' });
  });

  it('剛好滿 30 秒的那一刻已經拒絕（上限是「最遲」，不是「之後」）', async () => {
    vi.useFakeTimers();
    const results = {
      user_roles: { data: [{ role: 'admin', permissions: [] }] as unknown, error: null },
    };
    const app = appWithMutableIdentity(results);
    expect((await app.request('/admin-only')).status).toBe(200);

    results.user_roles = { data: [{ role: 'teacher', permissions: [] }], error: null };
    vi.advanceTimersByTime(REVOCATION_LIMIT_MS);

    expect((await app.request('/admin-only')).status).toBe(403);
  });

  it('快取按使用者分開：A 的身分不會被 B 拿去用', async () => {
    vi.useFakeTimers();
    const rolesByUser: Record<string, unknown[]> = {
      'user-a': [{ role: 'admin', permissions: [] }],
      'user-b': [],
    };
    const queriedUsers: string[] = [];
    fromMock.mockImplementation((table: string) => ({
      select: () => ({
        eq: (_column: string, userId: string) => {
          queriedUsers.push(userId);
          const data = table === 'user_roles' ? (rolesByUser[userId] ?? []) : [];
          return eqChain(Promise.resolve({ data, error: null }));
        },
      }),
    }));
    const app = new Hono<AppEnv>();
    app.use('*', authMiddleware);
    app.get('/admin-only', requireRoles('admin'), (c) => c.json({ ok: true }));

    getSession.mockResolvedValue({ user: { id: 'user-a', orgId: 'org-1' } });
    expect((await app.request('/admin-only')).status).toBe(200);

    getSession.mockResolvedValue({ user: { id: 'user-b', orgId: 'org-1' } });
    expect((await app.request('/admin-only')).status).toBe(403);
    expect(queriedUsers.filter((id) => id === 'user-b')).toHaveLength(3);
  });

  it('查詢失敗不進快取：下一個請求重查', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const results: Record<string, { data: unknown; error: unknown }> = {
      user_roles: { data: null, error: { message: 'boom' } },
    };
    const app = appWithMutableIdentity(results);
    expect((await app.request('/admin-only')).status).toBe(500);

    results['user_roles'] = { data: [{ role: 'admin', permissions: [] }], error: null };
    expect((await app.request('/admin-only')).status).toBe(200);
  });
});

/**
 * #1595 P2a：`/api/me` 的顯示名稱與生日改讀 middleware 帶出來的 `selfRows`，不再自己查。
 * 所以 staff／parents 的 select 要真的選到那幾欄 —— 選漏了，名稱會靜靜退回 ba_user.name。
 */
describe('authMiddleware 的 selfRows（#1595 P2a）', () => {
  afterEach(() => {
    getSession.mockReset();
    fromMock.mockReset();
  });

  it('staff／parents 的 select 帶上顯示欄位，並原樣放進 selfRows', async () => {
    const selects: Record<string, string> = {};
    const rows: Record<string, unknown[]> = {
      user_roles: [{ role: 'admin', permissions: [] }],
      staff: [
        { status: 'active', display_name: '王主任', birthday: '1990-01-02', staff_campuses: [] },
      ],
      parents: [{ status: 'active', name: '王媽媽', parent_student_relations: [] }],
    };
    getSession.mockResolvedValue({ user: { id: 'user-1', orgId: 'org-1' } });
    fromMock.mockImplementation((table: string) => ({
      select: (cols: string) => {
        selects[table] = cols;
        return { eq: () => eqChain(Promise.resolve({ data: rows[table] ?? [], error: null })) };
      },
    }));

    const app = new Hono<AppEnv>();
    app.use('*', authMiddleware);
    app.get('/', (c) => c.json(c.get('selfRows')));
    const body = await (await app.request('/')).json();

    expect(selects['staff']).toMatch(/\bdisplay_name\b/);
    expect(selects['staff']).toMatch(/\bbirthday\b/);
    expect(selects['parents']).toMatch(/\bname\b/);
    expect(body).toMatchObject({
      staff: { display_name: '王主任', birthday: '1990-01-02' },
      parent: { name: '王媽媽' },
    });
  });

  // #1607：/api/me 的 assignedCampusIds 跟 campusScope 必須是同一份，不然預設分校會挑到範圍外的
  it('selfRows.assignedCampusIds 跟 campusScope 是同一份 staff_campuses', async () => {
    const rows: Record<string, unknown[]> = {
      user_roles: [{ role: 'admin', permissions: [] }],
      staff: [{ status: 'active', staff_campuses: [{ campus_id: 'c2' }, { campus_id: 'c1' }] }],
    };
    getSession.mockResolvedValue({ user: { id: 'user-2', orgId: 'org-1' } });
    fromMock.mockImplementation((table: string) => ({
      select: () => ({
        eq: () => eqChain(Promise.resolve({ data: rows[table] ?? [], error: null })),
      }),
    }));

    const app = new Hono<AppEnv>();
    app.use('*', authMiddleware);
    app.get('/', (c) =>
      c.json({ self: c.get('selfRows').assignedCampusIds, scope: getCampusScope(c) }),
    );
    const body = (await (await app.request('/')).json()) as { self: string[]; scope: unknown };

    expect(body.self).toEqual(['c2', 'c1']);
    expect(body.scope).toEqual(body.self);
  });
});

/**
 * #1603：staff／parents 的唯一鍵是 (user_id, org_id)。身分查詢只用 user_id 的話，同一個人在
 * **別的 org** 的列會被合進來算 —— 停用判斷、分校範圍、可看的學生都會被污染。
 * 這個替身**真的照 `.eq()` 過濾**，所以拿掉 `org_id` 那個條件就會撈到別 org 的列。
 */
describe('authMiddleware 的身分查詢只看本 org（#1603）', () => {
  afterEach(() => {
    getSession.mockReset();
    fromMock.mockReset();
  });

  function appWithRows(rows: Record<string, Array<Record<string, unknown>>>) {
    getSession.mockResolvedValue({ user: { id: 'user-1', orgId: 'org-1' } });
    fromMock.mockImplementation((table: string) => ({
      select: () => {
        const filters: Array<[string, unknown]> = [];
        const query = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return query;
          },
          then: (resolve: (v: unknown) => unknown) =>
            resolve({
              data: (rows[table] ?? []).filter((row) => filters.every(([k, v]) => row[k] === v)),
              error: null,
            }),
        };
        return query;
      },
    }));
    const app = new Hono<AppEnv>();
    app.use('*', authMiddleware);
    app.get('/', (c) =>
      c.json({ campusScope: c.get('campusScope'), studentScope: c.get('studentScope') }),
    );
    return app;
  }

  it('同一個人在別 org 有停用的 staff 列、別的分校指派：不影響本 org 的判斷', async () => {
    const res = await appWithRows({
      user_roles: [{ user_id: 'user-1', role: 'admin', permissions: [] }],
      staff: [
        {
          user_id: 'user-1',
          org_id: 'org-1',
          status: 'active',
          staff_campuses: [{ campus_id: 'c-1' }],
        },
        {
          user_id: 'user-1',
          org_id: 'org-2',
          status: 'inactive',
          staff_campuses: [{ campus_id: 'c-other' }],
        },
      ],
    }).request('/');

    expect(res.status).toBe(200); // 別 org 的停用列沒有被算進來
    expect(await res.json()).toMatchObject({ campusScope: ['c-1'] }); // 也沒有混進 c-other
  });

  it('家長在別 org 的關聯學生不會混進 studentScope', async () => {
    const res = await appWithRows({
      user_roles: [{ user_id: 'user-1', role: 'parent', permissions: [] }],
      parents: [
        {
          user_id: 'user-1',
          org_id: 'org-1',
          status: 'active',
          parent_student_relations: [{ student_id: 's-1' }],
        },
        {
          user_id: 'user-1',
          org_id: 'org-2',
          status: 'active',
          parent_student_relations: [{ student_id: 's-other' }],
        },
      ],
    }).request('/');

    expect(await res.json()).toMatchObject({ studentScope: ['s-1'] });
  });
});

/**
 * Hyperdrive A（#1595）：身分查詢先走 SQL，失敗或形狀不對就走 REST。
 * 兩條路給同一份資料時，下游推出來的授權範圍要一模一樣（含 #1610 的 assignedCampusIds）。
 */
describe('authMiddleware 的身分 SQL 路徑與 REST 退路（Hyperdrive A）', () => {
  afterEach(() => {
    poolForTest = undefined;
    getSession.mockReset();
    fromMock.mockReset();
    vi.restoreAllMocks();
  });

  type Body = { roles: string[]; selfRows: { assignedCampusIds: string[] } };
  const ROLES = [{ role: 'admin', permissions: ['manage_students'] }];
  const STAFF = [
    {
      status: 'active',
      display_name: '王主任',
      birthday: '1990-01-02',
      staff_campuses: [{ campus_id: 'c-1' }, { campus_id: 'c-2' }],
    },
  ];
  const PARENTS = [
    { status: 'active', name: '王媽媽', parent_student_relations: [{ student_id: 's-1' }] },
  ];

  /** REST 替身：照表回固定列；記下被查了哪些表 */
  function restReturning(rows: Record<string, unknown[]>, queried: string[] = []) {
    fromMock.mockImplementation((table: string) => {
      queried.push(table);
      return {
        select: () => ({
          eq: () => eqChain(Promise.resolve({ data: rows[table] ?? [], error: null })),
        }),
      };
    });
  }

  function app() {
    getSession.mockResolvedValue({ user: { id: 'user-1', orgId: 'org-1' } });
    const a = new Hono<AppEnv>();
    a.use('*', authMiddleware);
    a.get('/', (c) =>
      c.json({
        roles: c.get('roles'),
        permissions: c.get('permissions'),
        campusScope: c.get('campusScope'),
        studentScope: c.get('studentScope'),
        selfRows: c.get('selfRows'),
      }),
    );
    return a;
  }

  it('SQL 與 REST 給同一份資料 → 角色、權限、campusScope、studentScope、assignedCampusIds 完全相同', async () => {
    poolForTest = {
      query: vi
        .fn()
        .mockResolvedValue({ rows: [{ roles: ROLES, staff: STAFF, parents: PARENTS }] }),
    };
    const queried: string[] = [];
    restReturning({}, queried);
    const viaSql = (await (await app().request('/')).json()) as Body;
    expect(queried).toEqual([]); // SQL 成功就不碰 REST

    // 清掉身分快取：不清的話第二個請求直接命中第一個的快取，等於自己比自己
    clearIdentityCache();
    poolForTest = undefined;
    const queriedRest: string[] = [];
    restReturning({ user_roles: ROLES, staff: STAFF, parents: PARENTS }, queriedRest);
    const viaRest = (await (await app().request('/')).json()) as Body;
    expect(queriedRest.sort()).toEqual(['parents', 'staff', 'user_roles']); // 真的走了 REST

    expect(viaSql).toEqual(viaRest);
    expect(viaSql.selfRows.assignedCampusIds).toEqual(['c-1', 'c-2']);
  });

  it('SQL 拋錯 → 走 REST，照樣授權', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    poolForTest = { query: vi.fn().mockRejectedValue(new Error('Hyperdrive 超過額度')) };
    const queried: string[] = [];
    restReturning({ user_roles: ROLES, staff: STAFF }, queried);

    const res = await app().request('/');
    expect(res.status).toBe(200);
    expect(((await res.json()) as Body).roles).toEqual(['admin']);
    expect(queried.sort()).toEqual(['parents', 'staff', 'user_roles']);
  });

  // 形狀不對時若拿來用：roles 是字串 → map 會丟錯或變空（＝「沒有角色」）；
  // staff 的 status 讀不到 → 可能被判成停用。兩種都不行，要走 REST
  it.each([
    ['roles 不是陣列', { roles: 'admin', staff: STAFF, parents: [] }],
    [
      'staff 列沒有 status',
      { roles: ROLES, staff: [{ display_name: 'x', staff_campuses: [] }], parents: [] },
    ],
    ['沒有列', null],
  ])('SQL 結果形狀不對（%s）→ 走 REST，不當成沒有角色、也不當成停用', async (_label, row) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    poolForTest = { query: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }) };
    const queried: string[] = [];
    restReturning({ user_roles: ROLES, staff: STAFF }, queried);

    const res = await app().request('/');
    expect(res.status).toBe(200);
    expect(((await res.json()) as Body).roles).toEqual(['admin']);
    expect(queried).toContain('user_roles');
  });

  // #1616 計畫席擋點：連線角色受 RLS 約束時，SQL 會乾淨地回三個空陣列 —— 形狀正確、看起來像沒有角色。
  // 不能就此拒絕：一律去問 REST
  it('SQL 回三個空陣列（例如連線角色被 RLS 擋住）→ 走 REST；REST 有角色就照樣授權', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    poolForTest = {
      query: vi.fn().mockResolvedValue({ rows: [{ roles: [], staff: [], parents: [] }] }),
    };
    const queried: string[] = [];
    restReturning({ user_roles: ROLES, staff: STAFF }, queried);

    const a = app();
    a.get('/admin-only', requireRoles('admin'), (c) => c.json({ ok: true }));
    expect((await a.request('/admin-only')).status).toBe(200);
    expect(queried).toContain('user_roles');
  });

  it('SQL 與 REST 都說沒有角色 → 照實拒絕（防線不會變成放行）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    poolForTest = {
      query: vi.fn().mockResolvedValue({ rows: [{ roles: [], staff: [], parents: [] }] }),
    };
    restReturning({});

    const a = app();
    a.get('/admin-only', requireRoles('admin'), (c) => c.json({ ok: true }));
    expect((await a.request('/admin-only')).status).toBe(403);
  });
});

/**
 * #1846：角色跟著身分資料的狀態走。重現（10-22 本機）：teacher0005 的 staff 停用、parents 仍 active，
 * `/api/me` 回 roles=["teacher","parent"]，老師端 API 200。
 * 過濾在每個請求從快取裡的原始列（含 status）重算 —— 停用最遲在下一次快取刷新生效。
 */
describe('authMiddleware：角色跟著身分資料的狀態走（#1846）', () => {
  afterEach(() => {
    vi.useRealTimers();
    getSession.mockReset();
    fromMock.mockReset();
  });

  function appWith(results: Record<string, { data: unknown; error: unknown }>) {
    getSession.mockResolvedValue({ user: { id: 'user-1', orgId: 'org-1' } });
    fromMock.mockImplementation((table: string) => ({
      select: () => ({
        eq: () => eqChain(Promise.resolve(results[table] ?? { data: [], error: null })),
      }),
    }));
    const app = new Hono<AppEnv>();
    app.use('*', authMiddleware);
    app.get('/teacher', requireRoles('teacher'), (c) => c.json({ ok: true }));
    app.get('/parent', requireRoles('parent'), (c) => c.json({ ok: true }));
    app.get('/admin', requireRoles('admin'), (c) => c.json({ ok: true }));
    app.get('/whoami', (c) =>
      c.json({
        roles: c.get('roles'),
        permissions: c.get('permissions'),
        activeRole: c.get('activeRole'),
      }),
    );
    return app;
  }

  const teacherAndParent = (staffStatus: string, parentStatus: string) => ({
    user_roles: {
      data: [
        { role: 'teacher', permissions: [] },
        { role: 'admin', permissions: ['manage_finance'] },
        { role: 'parent', permissions: [] },
      ],
      error: null,
    },
    staff: { data: [{ status: staffStatus, staff_campuses: [] }], error: null },
    parents: { data: [{ status: parentStatus, parent_student_relations: [] }], error: null },
  });

  it('staff 停用、parents 啟用 → 只剩 parent：老師端、管理員端都 403、權限清空，家長端照常', async () => {
    const app = appWith(teacherAndParent('inactive', 'active'));
    expect(await (await app.request('/whoami')).json()).toMatchObject({
      roles: ['parent'],
      permissions: [],
    });
    expect((await app.request('/teacher')).status).toBe(403);
    expect((await app.request('/admin')).status).toBe(403);
    expect((await app.request('/parent')).status).toBe(200);
  });

  it('前端還帶著舊的 X-Active-Role: teacher → 不採信（activeRole 是 null），不會被當成老師', async () => {
    const app = appWith(teacherAndParent('inactive', 'active'));
    const res = await app.request('/whoami', { headers: { 'X-Active-Role': 'teacher' } });
    expect(await res.json()).toMatchObject({ roles: ['parent'], activeRole: null });
  });

  it('兩邊都停用 → 不能登入（403 ACCOUNT_DISABLED）', async () => {
    const res = await appWith(teacherAndParent('inactive', 'archived')).request('/parent');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ACCOUNT_DISABLED' });
  });

  it('停用 staff：下一次快取刷新（≤30 秒）後老師端就擋，家長端照常', async () => {
    vi.useFakeTimers();
    const results = teacherAndParent('active', 'active');
    const app = appWith(results);
    expect((await app.request('/teacher')).status).toBe(200);

    results.staff = { data: [{ status: 'inactive', staff_campuses: [] }], error: null };
    vi.advanceTimersByTime(30_000 + 1);

    expect((await app.request('/teacher')).status).toBe(403);
    expect((await app.request('/parent')).status).toBe(200);
  });
});
