import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../index';
import { createServiceClientFromEnv } from '../lib/supabase';
import { DbUuidSchema } from '../lib/validation';
import { mintLoginLinkForRequest } from './login-links/mint';

/**
 * iOS 主畫面 PWA 的外部登入交接（#2027，設計 kb/wiki/architecture/pwa-oauth-handoff.md）。
 *
 * iOS 主畫面 PWA 與 Safari 不共用 cookie：LINE 授權完落在 Safari，PWA 仍未登入。
 * 1. PWA `POST /start` → 拿到 `handoffId`＋`secret`（**secret 只留在 PWA，不進任何 URL**；DB 只存雜湊）
 * 2. 外部流程的 callbackURL 只帶 `handoffId`；Safari 登入完成 → `POST /api/me/auth-handoff/{id}/complete`（要登入）標成「是誰」
 * 3. PWA 回前景 → `POST /{id}/redeem { secret }` → 換一條一次性登入連結，在自己的視窗打開
 *
 * 安全性：拿到 handoffId（LINE、瀏覽紀錄）沒有 secret 換不到；10 分鐘＋換過即刪；`complete` 只能由已登入的
 * 本人標（標的就是自己的 userId）；`redeem` 失敗不分原因一律 404 同一句話。
 */

export const HANDOFF_TTL_SECONDS = 10 * 60;
/** 全域同時未過期的交接上限：`start` 是公開端點，沒有這個上限就能被灌爆 */
export const MAX_PENDING_HANDOFFS = 500;

const ErrorSchema = z.object({ error: z.string(), code: z.string() }).openapi('AuthHandoffError');
const IdParam = z.object({ id: DbUuidSchema });

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const invalid = { error: '登入交接已失效，請重新按「使用 LINE 登入」', code: 'HANDOFF_INVALID' };

// ── 公開（authMiddleware 之前）：start、redeem ─────────────────────────────────
export const publicHandoffRoute = new OpenAPIHono<AppEnv>();

publicHandoffRoute.openapi(
  createRoute({
    method: 'post',
    path: '/start',
    tags: ['AuthHandoff'],
    summary: 'PWA 發起外部登入交接',
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': {
            schema: z.object({
              handoffId: DbUuidSchema,
              /** 只留在 PWA；不要放進任何 URL、不要記 log */
              secret: z.string(),
              expiresInSeconds: z.number(),
            }),
          },
        },
      },
      429: {
        description: '同時進行的交接太多',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    // authMiddleware 之前：自己建 service client（同 publicOrgMiddleware；測試替身已設就沿用）
    const supabase = c.get('supabase') ?? createServiceClientFromEnv(c.env);
    const failed = () => c.json({ error: '暫時無法登入，請稍後再試', code: 'HANDOFF_FAILED' }, 500);
    const now = new Date().toISOString();

    // 過期的順手清（沒有排程管它）；清失敗不擋發起
    await supabase.from('auth_handoffs').delete().lt('expires_at', now);
    const { count, error: countError } = await supabase
      .from('auth_handoffs')
      .select('id', { count: 'exact', head: true })
      .gte('expires_at', now);
    if (countError) return failed();
    if ((count ?? 0) >= MAX_PENDING_HANDOFFS) {
      return c.json({ error: '目前登入的人太多，請稍後再試', code: 'HANDOFF_BUSY' }, 429);
    }

    const secret = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const { data, error } = await supabase
      .from('auth_handoffs')
      .insert({
        secret_hash: await sha256Hex(secret),
        expires_at: new Date(Date.now() + HANDOFF_TTL_SECONDS * 1000).toISOString(),
      })
      .select('id')
      .single();
    if (error || !data) return failed();
    return c.json(
      { handoffId: data['id'] as string, secret, expiresInSeconds: HANDOFF_TTL_SECONDS },
      200,
    );
  },
);

publicHandoffRoute.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/redeem',
    tags: ['AuthHandoff'],
    summary: 'PWA 用 secret 換一次性登入連結（Safari 那邊還沒完成就回 pending）',
    request: {
      params: IdParam,
      body: {
        content: {
          'application/json': { schema: z.object({ secret: z.string().min(1).max(200) }) },
        },
      },
    },
    responses: {
      200: {
        description: '已完成：一次性登入連結（交接同時刪除）',
        content: { 'application/json': { schema: z.object({ url: z.string() }) } },
      },
      202: {
        description: 'Safari 那邊還沒完成',
        content: { 'application/json': { schema: z.object({ status: z.literal('pending') }) } },
      },
      404: {
        description: '不存在、過期、secret 不對、已換過',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    // authMiddleware 之前：自己建 service client（同 publicOrgMiddleware；測試替身已設就沿用）
    const supabase = c.get('supabase') ?? createServiceClientFromEnv(c.env);
    const { id } = c.req.valid('param');
    const { secret } = c.req.valid('json');
    const failed = () => c.json({ error: '暫時無法登入，請稍後再試', code: 'HANDOFF_FAILED' }, 500);
    const hash = await sha256Hex(secret);
    const now = new Date().toISOString();

    // secret 不對跟不存在分不出來：條件一起下
    const { data: row, error } = await supabase
      .from('auth_handoffs')
      .select('user_id')
      .eq('id', id)
      .eq('secret_hash', hash)
      .gte('expires_at', now)
      .maybeSingle();
    if (error) return failed();
    if (!row) return c.json(invalid, 404);
    if (!row['user_id']) return c.json({ status: 'pending' as const }, 202);

    // 一次性：刪得到的那一個請求才換得到（兩個請求同時進來，只有一個 delete 回得到列）
    const { data: taken, error: takeError } = await supabase
      .from('auth_handoffs')
      .delete()
      .eq('id', id)
      .eq('secret_hash', hash)
      .not('user_id', 'is', null)
      .select('user_id');
    if (takeError) return failed();
    const userId = (taken ?? [])[0]?.['user_id'] as string | undefined;
    if (!userId) return c.json(invalid, 404);

    const { data: user, error: userError } = await supabase
      .from('ba_user')
      .select('email')
      .eq('id', userId)
      .maybeSingle();
    if (userError) return failed();
    if (!user?.['email']) return c.json(invalid, 404);

    const url = await mintLoginLinkForRequest(c, user['email'] as string);
    if (!url) return failed();
    return c.json({ url }, 200);
  },
);

// ── 要登入：complete（掛在 /api/me/auth-handoff，routes/me.ts）──────────────────────
export const handoffCompleteRoute = new OpenAPIHono<AppEnv>();

handoffCompleteRoute.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/complete',
    tags: ['AuthHandoff'],
    summary: 'Safari 那邊登入完成：把這次交接標成目前登入的人',
    request: { params: IdParam },
    responses: {
      204: { description: '已標記' },
      404: {
        description: '不存在、過期、已被標過',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { data, error } = await c
      .get('supabase')
      .from('auth_handoffs')
      .update({ user_id: c.get('userId'), completed_at: new Date().toISOString() })
      .eq('id', id)
      .is('user_id', null)
      .gte('expires_at', new Date().toISOString())
      .select('id');
    if (error) return c.json({ error: '暫時無法登入，請稍後再試', code: 'HANDOFF_FAILED' }, 500);
    if ((data ?? []).length === 0) return c.json(invalid, 404);
    return c.body(null, 204);
  },
);
