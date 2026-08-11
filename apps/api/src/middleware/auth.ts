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

  c.set('userId', session.user.id);
  c.set('orgId', orgId);
  c.set('supabase', supabase);

  return next();
});

export const requireAdminMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const supabase = c.get('supabase');
  const userId = c.get('userId');

  const { data: roleRow, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle();

  if (error) {
    return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);
  }

  if (!roleRow) {
    return c.json({ error: '權限不足，僅管理者可執行此操作', code: 'FORBIDDEN' }, 403);
  }

  return next();
});
