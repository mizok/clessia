import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';

/**
 * 推播訂閱與通知偏好（#1659，設計稿 kb/wiki/architecture/web-push.md §3「授權」、§8）。
 * 掛在 `/api/me` 底下（ANY_ROLE），**一切都是「自己的」**：`user_id`／`org_id` 一律取自 session，
 * body 只收裝置給的東西（c1）。
 */

/**
 * 推播服務的網域白名單。#1661 的 Worker 會對 endpoint 發 POST —— 不限制的話，
 * 任何登入的人都能讓我們的 Worker 去打任意網址。新瀏覽器的推播服務不在這裡，就加一行。
 */
const PUSH_SERVICE_HOST_SUFFIXES = [
  'fcm.googleapis.com', // Chrome、Edge（新版）、Samsung Internet、Opera
  'push.services.mozilla.com', // Firefox
  'push.apple.com', // Safari（macOS 13+、iOS 16.4+ 加入主畫面）
  'notify.windows.com', // 舊版 Edge（WNS）
] as const;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return PUSH_SERVICE_HOST_SUFFIXES.some(
    (s) => url.hostname === s || url.hostname.endsWith(`.${s}`),
  );
}

/**
 * 每個角色開放哪些通知類型。**第一版只有家長**（#1626 Q7）；之後開放老師／行政是在這裡加一列，
 * 不改 schema（preferences 已帶 role）。
 */
export const ROLE_NOTIFICATION_KINDS = {
  parent: ['invoice_due', 'invoice_overdue'],
} as const;
type PushRole = keyof typeof ROLE_NOTIFICATION_KINDS;
const PushRoleSchema = z.enum(Object.keys(ROLE_NOTIFICATION_KINDS) as [PushRole]);
const KindSchema = z.enum(['invoice_due', 'invoice_overdue']);

const ErrorSchema = z.object({ error: z.string(), code: z.string() });

const SubscribeSchema = z
  .object({
    endpoint: z.string().max(2048),
    keys: z.object({
      /** 未壓縮 P-256 公鑰（65 bytes，首 byte 0x04）的 base64url —— 87 字、以 B 開頭 */
      p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}$/),
      /** 16 bytes 的 base64url —— 22 字 */
      auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    }),
    userAgent: z.string().max(300).optional(),
  })
  .openapi('PushSubscribeRequest');

const DeviceSchema = z.object({
  id: z.string(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  lastSuccessAt: z.string().nullable(),
});

const PreferencesSchema = z
  .object({
    role: PushRoleSchema,
    preferences: z.array(z.object({ kind: KindSchema, enabled: z.boolean() })),
  })
  .openapi('NotificationPreferences');

const app = new OpenAPIHono<AppEnv>();

// GET /api/me/push-config —— 前端訂閱要用的公鑰；沒設 VAPID 就是這份部署沒開推播
app.openapi(
  createRoute({
    method: 'get',
    path: '/push-config',
    tags: ['Push'],
    responses: {
      200: {
        description: 'VAPID 公鑰',
        content: { 'application/json': { schema: z.object({ publicKey: z.string() }) } },
      },
      404: {
        description: '這份部署沒有設定 VAPID（推播沒開）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  (c) => {
    const publicKey = c.env?.VAPID_PUBLIC_KEY;
    if (!publicKey) return c.json({ error: '推播尚未啟用', code: 'PUSH_NOT_CONFIGURED' }, 404);
    return c.json({ publicKey }, 200);
  },
);

// POST /api/me/push-subscriptions —— 這台裝置訂閱；同一個 endpoint 改綁成現在登入的人
app.openapi(
  createRoute({
    method: 'post',
    path: '/push-subscriptions',
    tags: ['Push'],
    request: { body: { content: { 'application/json': { schema: SubscribeSchema } } } },
    responses: {
      200: {
        description: '已訂閱',
        content: { 'application/json': { schema: z.object({ id: z.string() }) } },
      },
      400: {
        description: 'endpoint 不是已知推播服務的 https 網址',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: {
        description: '推播沒開',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '寫入失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const publicKey = c.env?.VAPID_PUBLIC_KEY;
    if (!publicKey) return c.json({ error: '推播尚未啟用', code: 'PUSH_NOT_CONFIGURED' }, 404);
    const body = c.req.valid('json');
    if (!isAllowedPushEndpoint(body.endpoint)) {
      return c.json({ error: '不支援的推播服務', code: 'PUSH_SERVICE_NOT_ALLOWED' }, 400);
    }

    // endpoint UNIQUE：共用平板、換手機給另一位家長 —— 推播要跟著**現在登入的人**走（設計稿 §3）。
    // 上一個人的成功紀錄不算這個人的，一併清掉
    const { data, error } = await c
      .get('supabase')
      .from('push_subscriptions')
      .upsert(
        {
          org_id: c.get('orgId'),
          user_id: c.get('userId'),
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          vapid_public_key: publicKey,
          user_agent: body.userAgent ?? null,
          last_success_at: null,
        },
        { onConflict: 'endpoint' },
      )
      .select('id')
      .single();
    if (error || !data) {
      console.error('[push] subscribe failed:', error?.message);
      return c.json({ error: '訂閱失敗', code: 'DB_ERROR' }, 500);
    }
    return c.json({ id: (data as { id: string }).id }, 200);
  },
);

// GET /api/me/push-subscriptions —— 自己已開啟通知的裝置（設定頁的裝置列表）
app.openapi(
  createRoute({
    method: 'get',
    path: '/push-subscriptions',
    tags: ['Push'],
    responses: {
      200: {
        description: '自己的裝置',
        content: { 'application/json': { schema: z.object({ data: z.array(DeviceSchema) }) } },
      },
      500: { description: '讀取失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { data, error } = await c
      .get('supabase')
      .from('push_subscriptions')
      .select('id, user_agent, created_at, last_success_at')
      .eq('user_id', c.get('userId'))
      .eq('org_id', c.get('orgId'))
      .order('created_at');
    if (error) return c.json({ error: '讀取失敗', code: 'DB_ERROR' }, 500);
    const rows = (data ?? []) as Array<Record<string, string | null>>;
    return c.json(
      {
        data: rows.map((r) => ({
          id: r['id'] as string,
          userAgent: r['user_agent'] ?? null,
          createdAt: r['created_at'] as string,
          lastSuccessAt: r['last_success_at'] ?? null,
        })),
      },
      200,
    );
  },
);

// DELETE /api/me/push-subscriptions —— 這台裝置取消（登出前呼叫）。只刪自己的、endpoint 相符的那一列
app.openapi(
  createRoute({
    method: 'delete',
    path: '/push-subscriptions',
    tags: ['Push'],
    request: {
      body: {
        content: { 'application/json': { schema: z.object({ endpoint: z.string().max(2048) }) } },
      },
    },
    responses: {
      200: {
        description: '刪掉幾列（別人的或不存在的 = 0，不洩漏是哪一種）',
        content: { 'application/json': { schema: z.object({ deleted: z.number() }) } },
      },
      500: { description: '刪除失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { endpoint } = c.req.valid('json');
    const { data, error } = await c
      .get('supabase')
      .from('push_subscriptions')
      .delete()
      .eq('user_id', c.get('userId'))
      .eq('org_id', c.get('orgId'))
      .eq('endpoint', endpoint)
      .select('id');
    if (error) return c.json({ error: '刪除失敗', code: 'DB_ERROR' }, 500);
    return c.json({ deleted: (data ?? []).length }, 200);
  },
);

// DELETE /api/me/push-subscriptions/:id —— 從裝置列表移除（手機掉了、換手機）
app.openapi(
  createRoute({
    method: 'delete',
    path: '/push-subscriptions/{id}',
    tags: ['Push'],
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: {
        description: '已移除',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      404: {
        description: '不存在或不是自己的',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '刪除失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { data, error } = await c
      .get('supabase')
      .from('push_subscriptions')
      .delete()
      .eq('id', id)
      .eq('user_id', c.get('userId'))
      .eq('org_id', c.get('orgId'))
      .select('id');
    if (error) return c.json({ error: '刪除失敗', code: 'DB_ERROR' }, 500);
    if ((data ?? []).length === 0) {
      return c.json({ error: '裝置不存在', code: 'NOT_FOUND' }, 404);
    }
    return c.json({ success: true }, 200);
  },
);

/** role 要是開放推播的角色（400），而且是這個人擁有的（403） */
function checkRole(roles: readonly string[], role: string) {
  if (!(role in ROLE_NOTIFICATION_KINDS)) {
    return { error: '這個身分沒有開放推播', code: 'ROLE_NOT_SUPPORTED', status: 400 as const };
  }
  if (!roles.includes(role)) {
    return { error: '不是你的身分', code: 'NOT_YOUR_ROLE', status: 403 as const };
  }
  return null;
}

// GET /api/me/notification-preferences?role=parent —— 沒有列 = 開
app.openapi(
  createRoute({
    method: 'get',
    path: '/notification-preferences',
    tags: ['Push'],
    request: { query: z.object({ role: z.string() }) },
    responses: {
      200: {
        description: '這個身分每一種類型的開關',
        content: { 'application/json': { schema: PreferencesSchema } },
      },
      400: {
        description: '不支援的身分',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      403: {
        description: '不是你的身分',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '讀取失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { role } = c.req.valid('query');
    const denied = checkRole(c.get('roles') ?? [], role);
    if (denied) {
      const body = { error: denied.error, code: denied.code };
      return denied.status === 400 ? c.json(body, 400) : c.json(body, 403);
    }
    const { data, error } = await c
      .get('supabase')
      .from('notification_preferences')
      .select('kind, enabled')
      .eq('user_id', c.get('userId'))
      .eq('org_id', c.get('orgId'))
      .eq('role', role);
    if (error) return c.json({ error: '讀取失敗', code: 'DB_ERROR' }, 500);
    const stored = new Map(
      ((data ?? []) as Array<{ kind: string; enabled: boolean }>).map((r) => [r.kind, r.enabled]),
    );
    const pushRole = role as PushRole;
    return c.json(
      {
        role: pushRole,
        preferences: ROLE_NOTIFICATION_KINDS[pushRole].map((kind) => ({
          kind,
          enabled: stored.get(kind) ?? true,
        })),
      },
      200,
    );
  },
);

// PUT /api/me/notification-preferences —— 在任何一台裝置上改，所有裝置都生效
app.openapi(
  createRoute({
    method: 'put',
    path: '/notification-preferences',
    tags: ['Push'],
    request: { body: { content: { 'application/json': { schema: PreferencesSchema } } } },
    responses: {
      200: {
        description: '已更新',
        content: { 'application/json': { schema: PreferencesSchema } },
      },
      400: {
        description: '不支援的身分或類型',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      403: {
        description: '不是你的身分',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '寫入失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const denied = checkRole(c.get('roles') ?? [], body.role);
    if (denied) {
      const err = { error: denied.error, code: denied.code };
      return denied.status === 400 ? c.json(err, 400) : c.json(err, 403);
    }
    const allowed: readonly string[] = ROLE_NOTIFICATION_KINDS[body.role];
    if (body.preferences.some((p) => !allowed.includes(p.kind))) {
      return c.json({ error: '這個身分沒有這種通知', code: 'KIND_NOT_FOR_ROLE' }, 400);
    }
    if (body.preferences.length > 0) {
      const { error } = await c
        .get('supabase')
        .from('notification_preferences')
        .upsert(
          body.preferences.map((p) => ({
            user_id: c.get('userId'),
            org_id: c.get('orgId'),
            role: body.role,
            kind: p.kind,
            enabled: p.enabled,
          })),
          { onConflict: 'user_id,role,kind' },
        );
      if (error) return c.json({ error: '儲存失敗', code: 'DB_ERROR' }, 500);
    }
    return c.json(body, 200);
  },
);

export default app;
