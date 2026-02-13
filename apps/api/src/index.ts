import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authMiddleware } from './middleware/auth';
import type { User } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Types
// ============================================================

type Bindings = {
  ENVIRONMENT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
};

type Variables = {
  user: User;
  supabase: SupabaseClient;
};

// ============================================================
// App
// ============================================================

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

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
  });
});

app.get('/health', (c) => {
  return c.json({ healthy: true, timestamp: new Date().toISOString() });
});

// ============================================================
// Protected Routes
// ============================================================

const api = new Hono<{ Bindings: Bindings; Variables: Variables }>();

api.use('*', authMiddleware);

api.get('/me', (c) => {
  const user = c.get('user');
  return c.json({
    id: user.id,
    email: user.email,
    createdAt: user.created_at,
  });
});

// Mount API routes
app.route('/api', api);

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
