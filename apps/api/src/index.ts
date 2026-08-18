import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authMiddleware, requireRoles } from './middleware/auth';
import { createAuth } from './auth';
import { resolveCorsOrigin } from './lib/origins';
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

// ============================================================
// Types
// ============================================================

export type Bindings = {
  ENVIRONMENT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WEB_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  DATABASE_URL: string;
  PLACEHOLDER_EMAIL_DOMAIN: string;
};

export type Variables = {
  userId: string;
  orgId: string;
  /** 每次請求從 user_roles 查出來的角色，不是 session 快照 */
  roles: string[];
  supabase: SupabaseClient;
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
    origin: (origin) => resolveCorsOrigin(origin),
    credentials: true,
  })
);

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
    path: '/system-time',
    tags: ['System'],
    summary: '取得伺服器時間',
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
      200
    );
  }
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
app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

// ── Unified login (before authMiddleware) ────────────────────────────────────
// Accepts email or phone. Looks up ba_user, checks status, then delegates sign-in
// to Better Auth for password verification + session creation.
app.post('/api/login', async (c) => {
  const body = await c.req.json<{ account?: string; password?: string; loginType?: string }>();
  const account = body.account?.trim();
  const password = body.password;
  const loginType =
    body.loginType === 'phone' ? 'phone' : body.loginType === 'username' ? 'username' : 'email';

  if (!account || !password) {
    return c.json({ error: 'account 與 password 為必填', code: 'MISSING_FIELDS' }, 400);
  }

  const supabase = createServiceClientFromEnv(c.env);

  // 1. Look up ba_user by email, phone, or username (determined by loginType from frontend)
  let baUserQuery;
  if (loginType === 'username') {
    baUserQuery = supabase.from('ba_user').select('id, email, phone, username').eq('username', account).maybeSingle();
  } else if (loginType === 'phone') {
    baUserQuery = supabase.from('ba_user').select('id, email, phone, username').eq('phone', account).maybeSingle();
  } else {
    baUserQuery = supabase.from('ba_user').select('id, email, phone, username').eq('email', account).maybeSingle();
  }
  const { data: baUser } = await baUserQuery;

  if (!baUser) {
    return c.json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' }, 401);
  }

  // 2. Status check — query both staff and parents
  const [{ data: staffRows }, { data: parentRows }] = await Promise.all([
    supabase.from('staff').select('status').eq('user_id', baUser.id),
    supabase.from('parents').select('status').eq('user_id', baUser.id),
  ]);

  const allRows = [...(staffRows ?? []), ...(parentRows ?? [])];

  if (allRows.length > 0) {
    const hasActive = allRows.some((r: { status: string }) => r.status === 'active');
    if (!hasActive) {
      return c.json({ error: '帳號已停用，請聯繫管理員', code: 'ACCOUNT_DISABLED' }, 401);
    }
  }
  // If no rows in staff or parents → system account (e.g. root), proceed

  // 3. Delegate sign-in to Better Auth (password verification + session creation)
  const auth = createAuth(c.env);
  try {
    if (loginType === 'username' && baUser.username) {
      // Username login (e.g. root) — status already checked above
      const sessionRes = await (auth.api as any).signInUsername({
        body: { username: baUser.username as string, password },
        asResponse: true,
      });
      return sessionRes;
    } else if (baUser.email) {
      const sessionRes = await auth.api.signInEmail({
        body: { email: baUser.email as string, password },
        asResponse: true,
      });
      return sessionRes;
    } else if (baUser.phone) {
      // Phone-only account: phone is stored as username (set at createUser time)
      const sessionRes = await (auth.api as any).signInUsername({
        body: { username: baUser.phone as string, password },
        asResponse: true,
      });
      return sessionRes;
    } else {
      return c.json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' }, 401);
    }
  } catch {
    return c.json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' }, 401);
  }
});

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
function mount(path: string, route: OpenAPIHono<AppEnv>, roles: string[]) {
  app.use(path, requireRoles(...roles));
  app.use(`${path}/*`, requireRoles(...roles));
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
mount('/api/students', studentsRoute, ADMIN_ONLY);
mount('/api/parents', parentsRoute, ADMIN_ONLY);
mount('/api/enrollments', enrollmentsRoute, ADMIN_ONLY);
mount('/api/org', orgSettingsRoute, ['admin', 'teacher']);
mount('/api/attendance', attendanceRoute, ['admin', 'teacher']);
mount('/api/leaves', leavesRoute, ADMIN_ONLY);
mount('/api/daily-checkins', dailyCheckinsRoute, ADMIN_ONLY);
mount('/api/academy-exams', academyExamsRoute, ADMIN_ONLY);
mount('/api/school-exams', schoolExamsRoute, ADMIN_ONLY);
mount('/api/scores', scoresRoute, ADMIN_ONLY);

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
    500
  );
});

// ============================================================
// 404 Handler
// ============================================================

app.notFound((c) => {
  return c.json({ error: 'Not Found', path: c.req.path }, 404);
});

export default app;
