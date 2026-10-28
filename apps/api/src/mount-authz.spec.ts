import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from './lib/permissions';

/**
 * #1730：`index.ts` 每一個 `mount()` 的授權（角色＋細部權限）。
 *
 * **期望值是手寫的，不從 index.ts 抽** —— 抽出來再比，驗的只是「index.ts 等於 index.ts」，
 * 拿掉一個權限兩邊一起變，照樣綠（#1728、#1739 二讀都抓到這個形狀）。
 * 改 mount 的權限 = 有意識地改這張表；新增 mount 忘了列進來 = 下面「數量對得上」紅。
 *
 * 走整個 app、只換掉 authMiddleware；打的是 `<mount>/__mount_probe__`（不存在的子路徑）：
 * mount 的守衛掛在 `<path>/*`，所以擋不擋只看 mount；過了守衛就是 404，不會撞到路由自己的檢查。
 * 每一列驗：缺角色 403、（admin 的）缺權限 403、齊了不是 403；`write` 型另驗沒權限照樣讀得到。
 */

type Role = 'admin' | 'teacher' | 'parent' | 'kiosk';
interface Expected {
  readonly roles: readonly Role[];
  /** 讀寫都要（`{ all }`） */
  readonly all?: string;
  /** 只擋寫（`{ write }`）；陣列＝任一即可 */
  readonly write?: string | readonly string[];
}

const ANY: readonly Role[] = ['admin', 'teacher', 'parent'];
const ADMIN: readonly Role[] = ['admin'];
const STAFF: readonly Role[] = ['admin', 'teacher'];

const EXPECTED: Record<string, Expected> = {
  '/api/me': { roles: ANY },
  '/api/courses': { roles: ADMIN, write: 'manage_courses' },
  '/api/campuses': { roles: ADMIN },
  '/api/schools': { roles: ADMIN, write: 'manage_courses' },
  '/api/staff': { roles: ADMIN, write: 'manage_staff' },
  '/api/subjects': { roles: ADMIN, write: 'manage_courses' },
  '/api/classes': { roles: ADMIN, write: 'manage_courses' },
  '/api/audit-logs': { roles: ADMIN, all: 'view_reports' },
  '/api/sessions': { roles: ADMIN, write: 'manage_courses' },
  '/api/teacher/session-changes': { roles: ['teacher'] },
  '/api/students': { roles: STAFF, write: 'manage_students' },
  '/api/parents': { roles: ADMIN, write: 'manage_students' },
  '/api/enrollments': { roles: ADMIN, write: 'manage_students' },
  '/api/org': { roles: STAFF },
  '/api/attendance': { roles: STAFF, write: 'basic_operations' },
  '/api/leaves': { roles: ADMIN, write: 'basic_operations' },
  '/api/daily-checkins': { roles: ['admin', 'kiosk'], write: 'basic_operations' },
  '/api/workbench': { roles: ADMIN },
  '/api/contact-logs': { roles: STAFF, write: ['basic_operations', 'manage_students'] },
  '/api/academy-exams': { roles: STAFF, write: 'basic_operations' },
  '/api/school-exams': { roles: STAFF, write: 'basic_operations' },
  '/api/scores': { roles: STAFF, write: 'basic_operations' },
  '/api/announcements': { roles: ANY },
  '/api/notifications': { roles: ANY },
  '/api/contact-book': { roles: STAFF, write: 'basic_operations' },
  '/api/class-logs': { roles: STAFF, write: 'basic_operations' },
  '/api/login-links': { roles: ADMIN },
  '/api/billing-periods': { roles: ADMIN, all: 'manage_finance' },
  // #1820：讀寫都要 manage_students；all_campuses 在路由內擋
  '/api/grade-promotions': { roles: ADMIN, all: 'manage_students' },
  '/api/fee-templates': { roles: ADMIN, all: 'manage_finance' },
  '/api/public-applications': { roles: ADMIN, all: 'manage_students' },
  '/api/parent-requests': { roles: ADMIN, all: 'manage_students' },
  '/api/invoices': { roles: ADMIN, all: 'manage_finance' },
  '/api/session-packs': { roles: ADMIN, all: 'manage_finance' },
  '/api/meals': { roles: ADMIN, all: 'manage_finance' },
  '/api/billing-runs': { roles: ADMIN, all: 'manage_finance' },
  // #1732：連續請假可不收費的明細有餐費單價、計費方式，讀也擋
  '/api/leave-streaks': { roles: ADMIN, all: 'manage_finance' },
  '/api/reports': { roles: ADMIN, all: 'view_reports' },
};

/**
 * **不經過 mount 守衛**、直接 `app.route()` 掛的路由（手寫白名單）。它們沒有角色門：
 * 公開表單走 `publicOrgMiddleware`（`/api/public/*`），推播排程走自己的 token（`internal-push.ts`）。
 * 有人用 `app.route` 掛新路由 = 那支完全沒有授權 → 下面對帳紅，逼人決定它該不該進 mount。
 */
const UNMOUNTED = [
  '/api/public/catalog',
  '/api/public/org',
  '/api/public/captcha',
  '/api/public/enrollment-applications',
  '/api/public/trial-applications',
  '/api/internal/push',
  // #2027 iOS PWA 外部登入交接的 start／redeem：PWA 還沒登入時打的，門是 secret（只存雜湊、一次性、10 分鐘）
  '/api/auth-handoff',
];

/**
 * 執行期 `app.routes` 裡，**不在任何 mount／白名單前綴底下**、允許存在的註冊（`方法 路徑`，手寫）。
 * **照實際註冊次數列，比的是多重集合**：同一個「方法＋路徑」再多掛一次（例如再一個 `ALL /api/*`
 * 的後門 middleware）也要紅（#1751 四讀 N12／N13）。
 */
const OUTSIDE_MOUNTS = [
  // 全域：logger、cors、authPoolCleanup
  'ALL /*',
  'ALL /*',
  'ALL /*',
  // authMiddleware、campusRequestGuard
  'ALL /api/*',
  'ALL /api/*',
  'ALL /api/public/*', // publicOrgMiddleware
  'GET /',
  'GET /health',
  'GET /openapi.json',
  'GET /docs',
  'GET /api/system-time', // 註冊在 authMiddleware 之前，刻意公開
  // Better Auth：兩次 app.on(['POST', 'GET'], '/api/auth/*')
  'GET /api/auth/*',
  'GET /api/auth/*',
  'POST /api/auth/*',
  'POST /api/auth/*',
];

const ALL_ROLES: readonly Role[] = ['admin', 'teacher', 'parent', 'kiosk'];

const ctx: { roles: string[]; permissions: string[] } = { roles: [], permissions: [] };

vi.mock('./middleware/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('./middleware/auth')>();
  const { createMiddleware } = await import('hono/factory');
  return {
    ...original,
    authMiddleware: createMiddleware(async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('orgId', 'org-a');
      set('userId', 'u-1');
      set('roles', ctx.roles);
      set('permissions', ctx.permissions);
      set('activeRole', ctx.roles[0]);
      set('studentScope', null);
      // 機台帳號綁一個分校（auth.ts 的 resolveCampusScope 對 kiosk 回指派的分校）
      set(
        'campusScope',
        ctx.roles.includes('kiosk') && !ctx.roles.includes('admin') ? ['campus-1'] : null,
      );
      await next();
    }),
  };
});

const env = { ENVIRONMENT: 'test', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };

type TestApp = {
  request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response>;
  routes: ReadonlyArray<{ method: string; path: string }>;
};
let app: TestApp;
// #1580：整個 app 的動態 import（transform 幾秒）放在 hook、逾時另計 ——
// 放在第一條測試裡會算進那條的 5 秒，機器忙時前幾條逾時、吃到模組快取的後面幾條又過
beforeAll(async () => {
  app = (await import('./index')).default as unknown as TestApp;
}, 30_000);

async function probe(
  path: string,
  method: 'GET' | 'POST',
  roles: Role[],
  permissions: string[],
  sub = '/__mount_probe__',
) {
  ctx.roles = roles;
  ctx.permissions = permissions;
  // POST 帶一個驗證不過的空物件：過了 mount 就停在路由的 400，不會真的寫進任何東西
  const init: RequestInit =
    method === 'POST'
      ? { method, headers: { 'content-type': 'application/json' }, body: '{}' }
      : { method };
  return (await app.request(`${path}${sub}`, init, env)).status;
}

describe('mount() 的授權（#1730）', () => {
  // 只抽「路徑」做數量對帳；期望的角色與權限一律手寫在表上
  const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

  it('index.ts 的 mount 跟這張表一一對得上（新路由忘了列進來就紅）', () => {
    // `\s*`：Prettier 會把超過 100 字的呼叫折成 `mount(⏎  '/api/…',`
    const mounted = [...source.matchAll(/^mount\(\s*'([^']+)'/gm)].map((m) => m[1]).sort();
    expect(mounted).toEqual(Object.keys(EXPECTED).sort());
  });

  // 路徑用變數或模板字串寫（`mount(SNEAKY, …)`、``app.route(`/api/x`, …)``）時，上面兩條抽路徑的 regex
  // 抓不到 → 多一道「呼叫次數」對帳，不管參數怎麼寫（#1751 二讀）
  // 文字對帳寫法再多也補不完（`app['route'](…)`、`app.get('/api/x', …)` 都繞得過）——
  // 直接看執行期 Hono 實際註冊了什麼（#1751 二讀）。上面的文字對帳留著當第二道
  it('執行期：每一條註冊的路由都在 mount／白名單前綴底下，或是明列的例外', async () => {
    const prefixes = [...Object.keys(EXPECTED), ...UNMOUNTED];
    // 不去重：重複註冊也算一條
    const stray = app.routes
      .filter((r) => !prefixes.some((p) => r.path === p || r.path.startsWith(`${p}/`)))
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(stray).toEqual([...OUTSIDE_MOUNTS].sort());
  });

  // Hono 照註冊順序跑：同一個前綴底下，若有 handler 比 mount 的守衛早註冊，它就跑在角色檢查之前
  it('執行期：每個 mount 前綴底下，第一條註冊的就是 mount 的守衛', async () => {
    const early = Object.keys(EXPECTED).flatMap((prefix) => {
      const first = app.routes.find((r) => r.path === prefix || r.path.startsWith(`${prefix}/`));
      return first && first.method === 'ALL' && first.path === prefix
        ? []
        : [`${prefix}：第一條是 ${first?.method} ${first?.path}`];
    });
    expect(early).toEqual([]);
  });

  it('呼叫次數也對得上：mount( 的次數＝表的筆數、app.route( 的次數＝白名單＋mount() 裡那一行', () => {
    // 排除 `function mount(` 定義本身；縮排在區塊裡的呼叫也算
    const mountCalls = source.match(/(?<![\w.$])(?<!function\s+)mount\(/g) ?? [];
    expect(mountCalls).toHaveLength(Object.keys(EXPECTED).length);
    // 任何 `.route(`（含把 app 換個名字再掛）都算
    const routeCalls = source.match(/\.route\(/g) ?? [];
    expect(routeCalls).toHaveLength(UNMOUNTED.length + 1);
  });

  it('直接 app.route 掛的（不經過 mount 守衛）只有白名單那幾支', () => {
    // mount() 函式裡那行是 `app.route(path, route)`，第一個參數不是字串字面值，不會被抓到
    const direct = [...source.matchAll(/app\.route\(\s*'([^']+)'/g)].map((m) => m[1]).sort();
    expect(direct).toEqual([...UNMOUNTED].sort());
  });

  describe.each(Object.entries(EXPECTED))('%s', (path, exp) => {
    const allowed = exp.roles[0]!;
    const writePerms = exp.write === undefined ? [] : [exp.write].flat();
    const needed = exp.all ?? writePerms[0];

    it('缺角色：讀寫都 403', async () => {
      for (const role of ALL_ROLES.filter((r) => !exp.roles.includes(r))) {
        expect(await probe(path, 'GET', [role], ['*']), `${role} GET`).toBe(403);
        expect(await probe(path, 'POST', [role], ['*']), `${role} POST`).toBe(403);
        // mount 在 `<path>` 與 `<path>/*` 各掛一次守衛，根也要擋
        expect(await probe(path, 'GET', [role], ['*'], ''), `${role} GET 根`).toBe(403);
      }
      expect(await probe(path, 'GET', [], ['*']), '沒有角色').toBe(403);
    });

    it('角色與權限都齊：讀寫都不是 403', async () => {
      for (const role of exp.roles) {
        const perms = role === 'admin' && needed ? [needed] : [];
        // 掃碼機台過了 mount 之後，daily-checkins 路由自己只放行「POST 到根」（#1127）——
        // 那是路由的事，不是 mount 的：只打那一個（空物件 → 400，過了 mount）
        if (role === 'kiosk') {
          expect(await probe(path, 'POST', [role], perms, ''), 'kiosk POST /').not.toBe(403);
          continue;
        }
        expect(await probe(path, 'GET', [role], perms), `${role} GET`).not.toBe(403);
        expect(await probe(path, 'POST', [role], perms), `${role} POST`).not.toBe(403);
      }
    });

    if (exp.roles.includes('admin')) {
      // 其他權限都給，只缺要的那一個（`*` 不給）
      const others = PERMISSIONS.filter((p) => p !== exp.all && !writePerms.includes(p));

      if (exp.all) {
        it(`管理員缺 ${exp.all}：讀寫都 403`, async () => {
          expect(await probe(path, 'GET', ['admin'], others)).toBe(403);
          expect(await probe(path, 'POST', ['admin'], others)).toBe(403);
        });
      } else if (writePerms.length > 0) {
        it(`管理員缺 ${writePerms.join('／')}：寫 403、讀照樣不是 403`, async () => {
          expect(await probe(path, 'POST', ['admin'], others)).toBe(403);
          expect(await probe(path, 'GET', ['admin'], others)).not.toBe(403);
        });
        if (writePerms.length > 1) {
          it('任一個權限就夠', async () => {
            for (const p of writePerms) {
              expect(await probe(path, 'POST', ['admin'], [p]), p).not.toBe(403);
            }
          });
        }
      } else {
        it('沒有細部權限：管理員什麼權限都沒有也不是 403', async () => {
          expect(await probe(path, 'GET', ['admin'], [])).not.toBe(403);
          expect(await probe(path, 'POST', ['admin'], [])).not.toBe(403);
        });
      }
    }
  });
});
