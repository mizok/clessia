import { createMiddleware } from 'hono/factory';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuth } from '../lib/get-auth';
import { createServiceClientFromEnv } from '../lib/supabase';
import { isAccountUsable } from './account-status';
import { hasPermission } from '../lib/permissions';
import { isCampusAllowed, resolveCampusScope } from '../lib/campus-scope';
import type { AppEnv } from '../index';

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const auth = getAuth(c);

  // Get session from request (supports both cookie and Authorization header)
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: 'Unauthorized', code: 'NO_SESSION' }, 401);
  }

  // Create service role client (no RLS - auth is handled at middleware level)
  const supabase: SupabaseClient = createServiceClientFromEnv(c.env);

  // org 的唯一真相是 `ba_user.orgId`（Better Auth additionalField），不是 `profiles.org_id`。
  //
  // 這裡曾經查 profiles，但 `profiles` 只剩 seed.sql 會寫入 —— 原本自動建列的
  // `handle_new_user()` 觸發器在 Better Auth 遷移（20260222000001）時就被 DROP 了，沒有替代品。
  // 而 staff.ts 與 parents.ts 建立帳號時寫的都是 `ba_user.orgId`。結果是**任何透過 app 建立的
  // 使用者都沒有 profiles 列，每一個請求都會拿到 400 NO_ORG**，等於完全無法使用系統。
  const orgId = (session.user as { orgId?: string | null }).orgId;

  if (!orgId) {
    return c.json({ error: '無法取得組織資訊', code: 'NO_ORG' }, 400);
  }

  // 角色每次請求查表，不從 session 讀。
  //
  // Better Auth 的 session 是登入當下的快照 —— 管理員撤銷某人的 teacher 角色後，
  // 那個人的 session 還在，讀 session 的話他就還是 teacher，權限要等到重新登入才生效。
  //
  // 帳號狀態也在這裡查。這個檢查原本住在 POST /api/login，那支端點隨密碼登入一起被
  // 刪除時**檢查沒有搬家** —— 被停用的家長只要還握著 LINE 綁定就能繼續進系統。
  // 放在這裡的代價是每個請求多一次查詢，但它跟角色查詢平行發，不多一次往返。
  const [
    { data: roleRows, error: rolesError },
    { data: staffRows, error: staffError },
    { data: parentRows, error: parentError },
  ] = await Promise.all([
    supabase.from('user_roles').select('role, permissions').eq('user_id', session.user.id),
    // 分校指派跟著 staff 一起查 —— 授權要在 middleware 層成立（c1），
    // 各路由自己去查的話總有一支會忘記，而忘記的方式是安靜的。
    supabase
      .from('staff')
      .select('status, staff_campuses(campus_id)')
      .eq('user_id', session.user.id),
    supabase.from('parents').select('status').eq('user_id', session.user.id),
  ]);

  // **失敗的原因要留下來。** 這三個 error 物件原本讀完就丟 —— 於是這條路只會在正式站
  // 產生一個沒有線索的 500：不知道是哪一支查詢、也不知道錯在什麼。
  // 而它是**每個受保護請求都會跑**的路徑，所以任何一次連線層的抖動都長這個樣子。
  //
  // 回應本身刻意維持原狀（不把 DB 錯誤吐給前端），細節只進 `console.error` ——
  // 那是 `wrangler tail` 看得到的地方。
  const identityFailures = (
    [
      ['user_roles', rolesError],
      ['staff', staffError],
      ['parents', parentError],
    ] as const
  ).filter(([, error]) => error);

  if (identityFailures.length > 0) {
    console.error(
      '[auth] 身分查詢失敗：' +
        identityFailures
          .map(([table, error]) => `${table}=${(error as { message?: string })?.message ?? error}`)
          .join('; '),
    );
    return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);
  }

  const statuses = [...(staffRows ?? []), ...(parentRows ?? [])].map(
    (row) => (row as { status: string }).status,
  );

  if (!isAccountUsable(statuses)) {
    return c.json({ error: '帳號已停用，請聯繫管理員', code: 'ACCOUNT_DISABLED' }, 403);
  }

  c.set('userId', session.user.id);
  c.set('orgId', orgId);
  const roles = (roleRows ?? []).map((row) => row.role as string);
  c.set('roles', roles);
  // 細部權限跟角色一樣**每個請求查表**，不從 session 讀 —— 撤銷權限要立刻生效。
  // 一個人可以有多個角色，權限是它們的聯集。
  const permissions = (roleRows ?? []).flatMap((row) =>
    Array.isArray((row as { permissions?: unknown }).permissions)
      ? ((row as { permissions: unknown[] }).permissions as string[])
      : [],
  );
  c.set('permissions', permissions);
  c.set('supabase', supabase);

  // 看得到哪些分校。`null` = 不受分校限制（跨分校的管理員，或由更窄的範圍
  // 限制把關的老師與家長）；空陣列 = 一個分校都沒被指派，什麼都看不到。
  c.set(
    'campusScope',
    resolveCampusScope({
      roles: roles,
      permissions: permissions,
      assignedCampusIds: (staffRows ?? []).flatMap((row) => {
        const links = (row as { staff_campuses?: { campus_id: string }[] | null }).staff_campuses;
        return Array.isArray(links) ? links.map((link) => link.campus_id) : [];
      }),
    }),
  );

  return next();
});

/**
 * 這個角色能不能呼叫這支 route。
 *
 * **fail-closed**：context 沒有 roles、帳號沒有任何角色、允許清單是空的 —— 一律拒絕。
 * 授權的洞幾乎都長在「不確定的時候放行」上，所以這裡每一種不確定都收斂到拒絕。
 */
export const requireRoles = (...allowed: string[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const roles = c.get('roles');

    if (!roles || roles.length === 0 || allowed.length === 0) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    if (!roles.some((role) => allowed.includes(role))) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    return next();
  });

/**
 * 請求指名分校時，它在不在這個人的範圍內。
 *
 * **掛在全域，不是各路由自己檢查。** `org_id` 之所以可信是因為它沒有例外（c1）；
 * 分校要的是同一種待遇。14 支路由收 `campusId`，靠每一支自己記得檢查的話，
 * 總有一支會忘記 —— 而忘記的方式是安靜的。
 *
 * **越權指名回 403 不是空清單。** 默默回空會讓越權嘗試看起來像「那個分校那天
 * 沒有人」：越權的人不知道自己被擋，被越權的機構也不會發現有人在試。
 *
 * 這一支只看 query string。**寫入時 body 帶的分校由各路由自己驗**
 * （middleware 讀 body 會跟 zod-openapi 的驗證器搶同一個 stream）。
 */
export const campusRequestGuard = createMiddleware<AppEnv>(async (c, next) => {
  const scope = c.get('campusScope');
  if (scope === null) return next();

  const url = new URL(c.req.url);
  const requested = [
    ...url.searchParams.getAll('campusId'),
    // 複數版是逗號分隔的清單
    ...url.searchParams.getAll('campusIds').flatMap((value) => value.split(',')),
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  if (requested.some((campusId) => !isCampusAllowed(scope, campusId))) {
    return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
  }

  return next();
});

/**
 * 這個**管理員**有沒有某個細部權限（`user_roles.permissions`）。
 *
 * **在金流之前 API 完全沒有這一層** —— `permissions` 只經由 `/api/me` 回給前端，
 * 由 web 的 `permissionGuard` 擋。那是畫面控制不是授權：直接打 API 就繞過去了。
 * 所以「有 manage_finance 才能改價目表」這件事必須在這裡成立，前端那層只是不要
 * 讓人點到一個必然失敗的按鈕。
 *
 * `*` 通吃 —— bootstrap 建的第一個管理員拿的就是它。規則跟 web 的
 * `auth.hasPermission()` 一致，兩邊不同步會變成「畫面看得到、API 打不進去」。
 *
 * **fail-closed**：context 沒有 permissions（例如有人在 authMiddleware 之外掛了它）、
 * 清單是空的 —— 一律拒絕。
 *
 * **ponytail: 同時擁有 admin 與 teacher 的人，缺權限時一律拒絕，不會降級成老師身分。**
 * 真的出現「會教課的分校主任被自己的管理員權限擋在點名外面」再拆 —— 正確的解通常是
 * 補上 `basic_operations`，而不是讓授權在角色之間偷偷降級。
 */
export const requireAdminPermission = (permission: string) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const roles = c.get('roles');

    // 沒有角色的一律拒絕，理由同 requireRoles。
    if (!roles || roles.length === 0) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    // **不是管理員就不看權限。** 老師的 `permissions` 一律是空陣列
    // （`staff.ts` 的 normalizeAdminPermissions 只對 admin 回非空），所以純粹的
    // permission 檢查會把 `['admin','teacher']` 那些 mount 上的老師全部鎖在門外。
    // 老師的範圍由角色層 + 各路由的 teacher-scope 把關，那是另一套尺。
    if (!roles.includes('admin')) {
      return next();
    }

    const permissions = c.get('permissions');

    if (!permissions || !hasPermission(permissions, permission)) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    return next();
  });

/**
 * 寫入只有管理員能做、而且要有這個權限；讀取不受限制。
 *
 * 跟 `mount()` 那層的 write 權限**刻意不同**：那一層碰到老師會放行（老師的範圍
 * 由 teacher-scope 把關），這一支碰到老師直接拒絕。用在「這件事本來就不是老師的事，
 * 但他讀得到」的路由上 —— 目前是組織設定：老師要讀點名時窗與模式，但不該改得動
 * 自己的補登天數。
 *
 * 見 kb/wiki/architecture/authorization-scope.md 洞 1。
 */
export const writeRequiresAdmin = (permission: string) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') {
      return next();
    }

    const roles = c.get('roles');
    if (!roles || !roles.includes('admin')) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    const permissions = c.get('permissions');
    if (!permissions || !hasPermission(permissions, permission)) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    return next();
  });

/**
 * 舊的別名。角色已經在 authMiddleware 查好放進 context，這裡不再各自查一次 ——
 * 同一個請求原本會查兩次 user_roles，現在一次。
 */
export const requireAdminMiddleware = requireRoles('admin');
