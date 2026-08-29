import { createMiddleware } from 'hono/factory';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuth } from '../lib/get-auth';
import { createServiceClientFromEnv } from '../lib/supabase';
import { isAccountUsable } from './account-status';
import type { AppEnv } from '../index';

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const auth = getAuth(c);

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

  // 角色每次請求查表，不從 session 讀。
  //
  // Better Auth 的 session 是登入當下的快照 —— 管理員撤銷某人的 teacher 角色後，
  // 那個人的 session 還在，讀 session 的話他就還是 teacher，權限要等到重新登入才生效。
  //
  // 帳號狀態也在這裡查。這個檢查原本住在 POST /api/login，那支端點隨密碼登入一起被
  // 刪除時**檢查沒有搬家** —— 被停用的家長只要還握著 LINE 綁定就能繼續進系統。
  // 放在這裡的代價是每個請求多一次查詢，但它跟角色查詢平行發，不多一次往返。
  const [
    { data: roleRows, error: rolesError },
    { data: staffRows, error: staffError },
    { data: parentRows, error: parentError },
  ] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', session.user.id),
    supabase.from('staff').select('status').eq('user_id', session.user.id),
    supabase.from('parents').select('status').eq('user_id', session.user.id),
  ]);

  if (rolesError || staffError || parentError) {
    return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);
  }

  const statuses = [...(staffRows ?? []), ...(parentRows ?? [])].map(
    (row) => (row as { status: string }).status,
  );

  if (!isAccountUsable(statuses)) {
    return c.json({ error: '帳號已停用，請聯繫管理員', code: 'ACCOUNT_DISABLED' }, 403);
  }

  c.set('userId', session.user.id);
  c.set('orgId', orgId);
  c.set(
    'roles',
    (roleRows ?? []).map((row) => row.role as string),
  );
  c.set('supabase', supabase);

  return next();
});

/**
 * 這個角色能不能呼叫這支 route。
 *
 * **fail-closed**：context 沒有 roles、帳號沒有任何角色、允許清單是空的 —— 一律拒絕。
 * 授權的洞幾乎都長在「不確定的時候放行」上，所以這裡每一種不確定都收斂到拒絕。
 */
export const requireRoles = (...allowed: string[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const roles = c.get('roles');

    if (!roles || roles.length === 0 || allowed.length === 0) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    if (!roles.some((role) => allowed.includes(role))) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    return next();
  });

/**
 * 舊的別名。角色已經在 authMiddleware 查好放進 context，這裡不再各自查一次 ——
 * 同一個請求原本會查兩次 user_roles，現在一次。
 */
export const requireAdminMiddleware = requireRoles('admin');
