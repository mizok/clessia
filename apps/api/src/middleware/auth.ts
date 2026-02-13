import { createMiddleware } from 'hono/factory';
import type { User } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from '../lib/supabase';

export type AuthVariables = {
  user: User;
  supabase: SupabaseClient;
};

export const authMiddleware = createMiddleware<{
  Bindings: {
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
  };
  Variables: AuthVariables;
}>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized', code: 'MISSING_TOKEN' }, 401);
  }

  const token = authHeader.slice(7);
  const supabase = createSupabaseClient(
    c.env.SUPABASE_URL,
    c.env.SUPABASE_ANON_KEY,
    token
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return c.json({ error: 'Unauthorized', code: 'INVALID_TOKEN' }, 401);
  }

  c.set('user', user);
  c.set('supabase', supabase);
  await next();
});
