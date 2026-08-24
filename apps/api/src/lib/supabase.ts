import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Bindings } from '../index';

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

export function createServiceClientFromEnv(env: Bindings): SupabaseClient {
  // 2026-08 Supabase 換了金鑰格式：sb_publishable_ / sb_secret_ 取代舊的 anon /
  // service_role JWT。變數跟著改名成 SUPABASE_SECRET_KEY —— dashboard 上叫「Secret key」，
  // 名稱對不上會讓人在 Settings 裡找不到東西（實際發生過）。
  // 語意不變：它仍然對應 service_role，會繞過 RLS。
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
