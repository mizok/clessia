import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authMiddleware } from './middleware/auth';
import { createAuth } from './auth';
import campusesRoute from './routes/campuses';
import coursesRoute from './routes/courses';
import staffRoute from './routes/staff';
import subjectsRoute from './routes/subjects';
import type { SupabaseClient } from '@supabase/supabase-js';

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

// ============================================================
// Global Middleware
// ============================================================

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: ['http://localhost:4200', 'https://clessia.pages.dev'],
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

app.use('/api/*', authMiddleware);

// Mount routes
app.route('/api/courses', coursesRoute);
app.route('/api/campuses', campusesRoute);
app.route('/api/staff', staffRoute);
app.route('/api/subjects', subjectsRoute);

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
