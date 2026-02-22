import { createMiddleware } from 'hono/factory';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuth } from '../auth';
import { createServiceClientFromEnv } from '../lib/supabase';
import type { AppEnv } from '../index';

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const auth = createAuth(c.env);

  // Get session from request (supports both cookie and Authorization header)
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: 'Unauthorized', code: 'NO_SESSION' }, 401);
  }

  // Create service role client (no RLS - auth is handled at middleware level)
  const supabase: SupabaseClient = createServiceClientFromEnv(c.env);

  // Get org_id from profiles table using the Better Auth user ID
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', session.user.id)
    .single();

  if (profileError || !profile?.org_id) {
    return c.json({ error: '無法取得組織資訊', code: 'NO_ORG' }, 400);
  }

  c.set('userId', session.user.id);
  c.set('orgId', profile.org_id);
  c.set('supabase', supabase);

  return next();
});
