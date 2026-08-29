import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { mintLoginLinkForRequest } from './login-links/mint';
import { decideLoginLinkTarget } from './login-links/target';

const app = new OpenAPIHono<AppEnv>();

const RequestSchema = z.object({ userId: z.string().min(1) }).openapi('CreateLoginLinkRequest');

const ResponseSchema = z
  .object({
    /** 完整連結。前端把它變成 QR 或可複製的文字，**不要記錄到任何 log** */
    url: z.string(),
    /** 給畫面顯示用，例如「24 小時內有效」 */
    expiresInSeconds: z.number(),
  })
  .openapi('CreateLoginLinkResponse');

const ErrorSchema = z.object({ error: z.string(), code: z.string() }).openapi('LoginLinkError');

/**
 * POST /api/login-links —— 替某個使用者產生一次性登入連結。
 *
 * 用途是**綁定**：家長／老師點開連結就登入了，接著在畫面上綁定 LINE。之後他們用 LINE
 * 登入，這條連結就不再需要。臨櫃註冊完當場顯示 QR 是成功率最高的時刻。
 *
 * 連結就是帳號 —— 跨組織的檢查在 `decideLoginLinkTarget()`，那是這支端點唯一重要的事。
 */
const createLinkRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['LoginLinks'],
  summary: '產生一次性登入連結（供綁定 LINE 用）',
  request: { body: { content: { 'application/json': { schema: RequestSchema } } } },
  responses: {
    200: { description: '成功', content: { 'application/json': { schema: ResponseSchema } } },
    404: { description: '找不到', content: { 'application/json': { schema: ErrorSchema } } },
    422: { description: '無法產生', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(createLinkRouteDef, async (c) => {
  const { userId } = c.req.valid('json');
  const supabase = c.get('supabase');
  const callerOrgId = c.get('orgId');

  const [{ data: baUser }, { data: roleRows }] = await Promise.all([
    supabase.from('ba_user').select('email, orgId').eq('id', userId).maybeSingle(),
    supabase.from('user_roles').select('role').eq('user_id', userId),
  ]);

  const decision = decideLoginLinkTarget(
    baUser
      ? {
          orgId: (baUser['orgId'] as string | null) ?? null,
          roles: (roleRows ?? []).map((r: { role: string }) => r.role),
        }
      : null,
    callerOrgId,
  );

  if (!decision.ok) {
    // 分開寫是因為 zod-openapi 要求字面量狀態碼，不吃 404 | 422 的聯集
    if (decision.code === 'NO_ROLES') {
      return c.json({ error: '這個帳號還沒有任何角色', code: 'NO_ROLES' }, 422);
    }
    return c.json({ error: '找不到這個使用者', code: 'NOT_FOUND' }, 404);
  }

  const email = baUser?.['email'] as string | null;
  if (!email) {
    // ba_user.email 可為 NULL；magic-link 用 email 當識別碼，沒有就產不出來
    return c.json({ error: '這個帳號沒有 email，無法產生連結', code: 'NO_EMAIL' }, 422);
  }

  const url = await mintLoginLinkForRequest(c, email);

  if (!url) {
    return c.json({ error: '產生連結失敗', code: 'LINK_FAILED' }, 422);
  }

  // 明寫 200：不帶狀態碼的話 Hono 會推導成所有宣告狀態的聯集，型別對不起來
  return c.json({ url, expiresInSeconds: 60 * 60 * 24 }, 200);
});

export default app;
