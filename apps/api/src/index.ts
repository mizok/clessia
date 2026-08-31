import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authMiddleware, requirePermission, requireRoles } from './middleware/auth';
import type { Auth, MagicLinkPayload } from './auth';
import { authPoolCleanup, getAuth } from './lib/get-auth';
import { allowedOrigins, resolveCorsOrigin } from './lib/origins';
import loginLinksRoute from './routes/login-links';
import billingPeriodsRoute from './routes/billing-periods';
import feeTemplatesRoute from './routes/fee-templates';
import invoicesRoute from './routes/invoices';
import sessionPacksRoute from './routes/session-packs';
import mealsRoute from './routes/meals';
import billingRunsRoute from './routes/billing-runs';
import reportsRoute from './routes/reports';
import { isPubliclyBlockedAuthPath } from './lib/auth-paths';
import { createServiceClientFromEnv } from './lib/supabase';
import campusesRoute from './routes/campuses';
import schoolsRoute from './routes/schools';
import coursesRoute from './routes/courses';
import staffRoute from './routes/staff';
import subjectsRoute from './routes/subjects';
import classesRoute from './routes/classes';
import auditLogsRoute from './routes/audit-logs';
import sessionsRoute from './routes/sessions';
import studentsRoute from './routes/students';
import parentsRoute from './routes/parents';
import enrollmentsRoute from './routes/enrollments';
import meRoute from './routes/me';
import orgSettingsRoute from './routes/org-settings';
import attendanceRoute from './routes/attendance';
import leavesRoute from './routes/leaves';
import dailyCheckinsRoute from './routes/daily-checkins';
import academyExamsRoute from './routes/academy-exams';
import schoolExamsRoute from './routes/school-exams';
import scoresRoute from './routes/scores';
import announcementsRoute from './routes/announcements';
import contactBookRoute from './routes/contact-book';
import classLogsRoute from './routes/class-logs';

// ============================================================
// Types
// ============================================================

export type Bindings = {
  ENVIRONMENT: string;
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
  WEB_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  DATABASE_URL: string;
  /**
   * Hyperdrive binding（`wrangler.toml` 的 `[[env.production.hyperdrive]]`）。
   *
   * **可選**：本機 `wrangler dev` 與 `server.ts` 的 Node 自架路徑都沒有它，
   * 那些情境退回 `DATABASE_URL`（見 `lib/database-url.ts`）。
   */
  HYPERDRIVE?: Hyperdrive;
  PLACEHOLDER_EMAIL_DOMAIN: string;
  /** 逗號分隔的額外允許來源；WEB_URL 已隱含可信，不必重複列 */
  ALLOWED_ORIGINS: string;
  /** LINE Login channel ID —— 非機密，部署時用 --var 傳 */
  LINE_CLIENT_ID: string;
  /** LINE Login channel secret —— 走 wrangler secret put */
  LINE_CLIENT_SECRET: string;
};

export type Variables = {
  userId: string;
  orgId: string;
  /** 每次請求從 user_roles 查出來的角色，不是 session 快照 */
  roles: string[];
  /** 同上，`user_roles.permissions` 的聯集。`*` 代表全部（見 requirePermission） */
  permissions: string[];
  supabase: SupabaseClient;
  /** 這個請求共用的 Better Auth 實例與連線池，由 `lib/get-auth.ts` 管理 */
  auth: Auth;
  /** magic-link 的每請求攔截槽 —— `mintLoginLinkForRequest` 設好、用完即清 */
  magicLinkCapture?: (payload: MagicLinkPayload) => void;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

// ============================================================
// App
// ============================================================

const app = new OpenAPIHono<AppEnv>();

const SystemTimeResponseSchema = z
  .object({
    epochMs: z.number(),
    iso: z.string(),
  })
  .openapi('SystemTimeResponse');

// ============================================================
// Global Middleware
// ============================================================

app.use('*', logger());
app.use(
  '*',
  cors({
    // env 一定要從 c 拿 —— Workers 的環境變數不在 process.env 上
    origin: (origin, c) => resolveCorsOrigin(origin, allowedOrigins(c.env)),
    credentials: true,
  }),
);

// 連線池的收尾。**掛在所有會用到 auth 的東西之前** —— 它靠 `await next()` 之後才動手，
// 掛得太後面的話 `/api/auth/*` 那條路開的池就收不到。見
// kb/wiki/architecture/auth-pool-lifecycle.md
app.use('*', authPoolCleanup);

// ============================================================
// Public Routes
// ============================================================

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    name: 'Clessia API',
    version: '0.0.1',
    env: c.env.ENVIRONMENT,
    docs: '/docs',
  });
});

app.get('/health', (c) => {
  return c.json({ healthy: true, timestamp: new Date().toISOString() });
});

app.openapi(
  createRoute({
    method: 'get',
    // **`/api/` 前綴是必要的，不是慣例。** 正式站的 Cloudflare 路由只有 `/api/*`
    // 進 Worker，其餘走 Pages —— 掛在 `/system-time` 的話請求根本到不了這裡，
    // 回的是 SPA 的 index.html（485 KB）。`system-clock.service.ts` 會 JSON parse
    // 失敗然後靜靜退回用瀏覽器時間，錯得沒有徵兆。
    //
    // 這一行註冊在 `app.use('/api/*', authMiddleware)` **之前**，所以它仍然是公開的。
    path: '/api/system-time',
    tags: ['System'],
    summary: '取得伺服器時間（公開）',
    responses: {
      200: {
        description: '成功取得伺服器時間',
        content: {
          'application/json': {
            schema: SystemTimeResponseSchema,
          },
        },
      },
    },
  }),
  (c) => {
    const now = new Date();
    return c.json(
      {
        epochMs: now.getTime(),
        iso: now.toISOString(),
      },
      200,
    );
  },
);

// ============================================================
// OpenAPI Documentation
// ============================================================

app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    title: 'Clessia API',
    version: '0.0.1',
    description: '學程管家 - 補習班管理系統 API',
  },
  servers: [
    { url: 'http://localhost:8787', description: 'Local Development' },
    { url: 'https://clessia-api.workers.dev', description: 'Production' },
  ],
});

app.get('/docs', swaggerUI({ url: '/openapi.json' }));

// ============================================================
// Protected API Routes
// ============================================================

// Better Auth handler - must be BEFORE authMiddleware
// magic-link 的產生端點只在伺服器端用（破窗 CLI、管理端 route）——
// 對外開放等於多一個「拿到連結就是拿到帳號」的入口。見 lib/auth-paths.ts
app.on(['POST', 'GET'], '/api/auth/*', async (c, next) => {
  if (isPubliclyBlockedAuthPath(new URL(c.req.url).pathname)) {
    return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  }
  await next();
  return undefined;
});

app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
  return getAuth(c).handler(c.req.raw);
});

// ── Unified login (before authMiddleware) ────────────────────────────────────
// Accepts email or phone. Looks up ba_user, checks status, then delegates sign-in
// to Better Auth for password verification + session creation.
// 原本這裡有 POST /api/login（email / 手機 / username + 密碼）。
//
// 整支移除：密碼驗證用 scrypt，那是刻意設計成昂貴的演算法，而 Cloudflare Workers
// 免費方案每個請求只有 10ms CPU —— 實測並發 1 也會 503。任何安全的密碼雜湊都會
// 超過 10ms，那正是它們存在的意義，所以這無法靠改程式碼修好。
//
// 取而代之：LINE OAuth（日常）+ 一次性登入連結（首次綁定與破窗）。
// 見 kb/wiki/architecture/line-oauth-login.md

app.use('/api/*', authMiddleware);

// ============================================================
// Mount routes
//
// 每一支掛載都必須宣告可用角色 —— roles 不是 optional，忘了寫連編譯都過不了。
// 想全開要明寫 ANY_ROLE，那是一個看得見的決定，不是忘記的後果。
// 由 tools/agent-harness 的 gate 守住（見 kb/wiki/architecture/role-authorization.md）。
//
// **只開現在真的有頁面在用的。** 老師端規格提到要看學生與成績，但那些頁面還是空殼；
// 做到那一頁時再連同「只看自己班」的範圍限制一起開。
// ============================================================

const ANY_ROLE = ['admin', 'teacher', 'parent'];
const ADMIN_ONLY = ['admin'];

// app.route 有多載，Parameters<> 取不到正確的那一個；掛載的 route 全是 OpenAPIHono
function mount(path: string, route: OpenAPIHono<AppEnv>, roles: string[], permission?: string) {
  app.use(path, requireRoles(...roles));
  app.use(`${path}/*`, requireRoles(...roles));
  // 細部權限是 optional 的第四個參數 —— 角色是准入的底線，權限是「這個管理員負責
  // 這一塊嗎」。金流是第一個真的需要它的地方；沒有它的話「有 manage_finance 才能改
  // 價目表」只存在於前端，直接打 API 就繞過去了。
  if (permission) {
    app.use(path, requirePermission(permission));
    app.use(`${path}/*`, requirePermission(permission));
  }
  app.route(path, route);
}

mount('/api/me', meRoute, ANY_ROLE);
mount('/api/courses', coursesRoute, ADMIN_ONLY);
mount('/api/campuses', campusesRoute, ADMIN_ONLY);
mount('/api/schools', schoolsRoute, ADMIN_ONLY);
mount('/api/staff', staffRoute, ADMIN_ONLY);
mount('/api/subjects', subjectsRoute, ADMIN_ONLY);
mount('/api/classes', classesRoute, ADMIN_ONLY);
mount('/api/audit-logs', auditLogsRoute, ADMIN_ONLY);
mount('/api/sessions', sessionsRoute, ADMIN_ONLY);
mount('/api/students', studentsRoute, ['admin', 'teacher']);
mount('/api/parents', parentsRoute, ADMIN_ONLY);
mount('/api/enrollments', enrollmentsRoute, ADMIN_ONLY);
mount('/api/org', orgSettingsRoute, ['admin', 'teacher']);
mount('/api/attendance', attendanceRoute, ['admin', 'teacher']);
mount('/api/leaves', leavesRoute, ADMIN_ONLY);
mount('/api/daily-checkins', dailyCheckinsRoute, ADMIN_ONLY);
// 成績三支開給老師，但**範圍限制在路由層**（`lib/exam-scope.ts` / `lib/teacher-scope.ts`）：
// 老師只碰自己固定任課的班。單純把角色加上去是不安全的 —— 那會讓任何老師讀寫全校的
// 考試與成績。見 .claude/team/billing-api-p3-grades-scope-design.md
mount('/api/academy-exams', academyExamsRoute, ['admin', 'teacher']);
mount('/api/school-exams', schoolExamsRoute, ['admin', 'teacher']);
mount('/api/scores', scoresRoute, ['admin', 'teacher']);
// 收件匣對 teacher/parent 開放；發布與管理端列表在 route 內另外要求 admin
mount('/api/announcements', announcementsRoute, ANY_ROLE);
// 聯絡簿與教務日誌：admin 與 teacher 都寫得到，老師的範圍在 route 內縮限到
// 自己固定任課的班（lib/teacher-scope）。家長端的簽收與已閱是 P4。
mount('/api/contact-book', contactBookRoute, ['admin', 'teacher']);
mount('/api/class-logs', classLogsRoute, ['admin', 'teacher']);
// 產生登入連結 = 產生一個能登入的憑證。只有 admin，且只能對同組織的人
mount('/api/login-links', loginLinksRoute, ADMIN_ONLY);

// 金流：admin 角色之外還要 manage_finance（見 kb/wiki/rules/billing-rules.md）
mount('/api/billing-periods', billingPeriodsRoute, ADMIN_ONLY, 'manage_finance');
mount('/api/fee-templates', feeTemplatesRoute, ADMIN_ONLY, 'manage_finance');
mount('/api/invoices', invoicesRoute, ADMIN_ONLY, 'manage_finance');
mount('/api/session-packs', sessionPacksRoute, ADMIN_ONLY, 'manage_finance');
mount('/api/meals', mealsRoute, ADMIN_ONLY, 'manage_finance');
mount('/api/billing-runs', billingRunsRoute, ADMIN_ONLY, 'manage_finance');

// 報表是**唯讀**，用 view_reports 不是 manage_finance —— 老闆可能只給主任看營收
// 而不給動錢（見 kb/wiki/specs/admin/finance/reports.md）
mount('/api/reports', reportsRoute, ADMIN_ONLY, 'view_reports');

// ============================================================
// Error Handler
// ============================================================

app.onError((err, c) => {
  console.error('API Error:', err);
  return c.json(
    {
      error: 'Internal Server Error',
      message: c.env.ENVIRONMENT === 'development' ? err.message : undefined,
    },
    500,
  );
});

// ============================================================
// 404 Handler
// ============================================================

app.notFound((c) => {
  return c.json({ error: 'Not Found', path: c.req.path }, 404);
});

export default app;
