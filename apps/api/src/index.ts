import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authMiddleware } from './middleware/auth';
import { createAuth } from './auth';
import { resolveCorsOrigin } from './lib/origins';
import { createServiceClientFromEnv } from './lib/supabase';
import campusesRoute from './routes/campuses';
import coursesRoute from './routes/courses';
import staffRoute from './routes/staff';
import subjectsRoute from './routes/subjects';
import classesRoute from './routes/classes';
import auditLogsRoute from './routes/audit-logs';
import sessionsRoute from './routes/sessions';
import studentsRoute from './routes/students';
import parentsRoute from './routes/parents';

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
};

export type Variables = {
  userId: string;
  orgId: string;
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
  const loginType = body.loginType === 'phone' ? 'phone' : 'email';

  if (!account || !password) {
    return c.json({ error: 'account 與 password 為必填', code: 'MISSING_FIELDS' }, 400);
  }

  const supabase = createServiceClientFromEnv(c.env);

  // 1. Look up ba_user by email or phone (determined by loginType from frontend)
  const { data: baUser } =
    loginType === 'phone'
      ? await supabase.from('ba_user').select('id, email, phone').eq('phone', account).maybeSingle()
      : await supabase.from('ba_user').select('id, email, phone').eq('email', account).maybeSingle();

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
    if (baUser.email) {
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

// GET /api/me - 取得目前登入用戶的 profile 和 roles
app.get('/api/me', async (c) => {
  const supabase = c.get('supabase');
  const userId = c.get('userId');
  const orgId = c.get('orgId');

  const [profileResult, rolesResult] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', userId).single(),
    supabase.from('user_roles').select('role, permissions').eq('user_id', userId),
  ]);

  return c.json({
    userId,
    orgId,
    displayName: profileResult.data?.display_name ?? '',
    roles: (rolesResult.data ?? []).map((r: { role: string; permissions: unknown[] }) => r.role),
    permissions: (rolesResult.data ?? []).flatMap((r: { role: string; permissions: unknown[] }) =>
      Array.isArray(r.permissions) ? r.permissions : []
    ),
  });
});

// Mount routes
app.route('/api/courses', coursesRoute);
app.route('/api/campuses', campusesRoute);
app.route('/api/staff', staffRoute);
app.route('/api/subjects', subjectsRoute);
app.route('/api/classes', classesRoute);
app.route('/api/audit-logs', auditLogsRoute);
app.route('/api/sessions', sessionsRoute);
app.route('/api/students', studentsRoute);
app.route('/api/parents', parentsRoute);

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
