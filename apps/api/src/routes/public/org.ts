import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../../index';

/**
 * 公開頁的補習班名稱（#1858，免登入）—— 入口頁（登入／試聽／報名）的品牌面要讓家長一眼知道是哪一間。
 *
 * **只回 `name`**：未登入就讀得到，所以不回 id、slug 或任何其他設定（`org.spec.ts` 斷言 key 只有一個）。
 * org 由 `publicOrgMiddleware` 從 `PUBLIC_ORG_SLUG` 解析；沒設一律 404，前端就不顯示名稱。
 */

const OrgResponseSchema = z.object({ name: z.string() }).openapi('PublicOrg');
const ErrorSchema = z.object({ error: z.string(), code: z.string() }).openapi('PublicOrgError');

const app = new OpenAPIHono<AppEnv>();

// GET /api/public/org
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Public'],
    summary: '公開頁的補習班名稱（免登入）',
    responses: {
      200: { description: '成功', content: { 'application/json': { schema: OrgResponseSchema } } },
      404: {
        description: '這個部署沒有開放公開頁（PUBLIC_ORG_SLUG 未設定）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { data, error } = await c
      .get('supabase')
      .from('organizations')
      .select('name')
      .eq('id', c.get('orgId'))
      .maybeSingle();
    if (error || !data) return c.json({ error: '讀取補習班名稱失敗', code: 'FETCH_ORG_FAILED' }, 500);
    return c.json({ name: data.name as string }, 200);
  },
);

export default app;
