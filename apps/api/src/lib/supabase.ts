import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function createSupabaseClient(
  url: string,
  key: string,
  accessToken?: string
): SupabaseClient {
  return createClient(url, key, {
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : {},
  });
}

export function createServiceClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
