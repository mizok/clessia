import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { DbUuidSchema } from '../../lib/validation';

/**
 * 家長端專屬的檔案。**這裡不用 `c.get('supabase')`，一律用 `c.get('childDb')`**——
 * 見 kb/wiki/architecture/parent-data-scope.md 第二節、`lib/child-db.ts`。
 * 由 A19 gate 收尾：`routes/parent/**` 出現 `c.get('supabase')` 會擋。
 */

const ChildSchema = z
  .object({
    id: DbUuidSchema,
    name: z.string(),
    grade: z.string(),
    school: z.string(),
  })
  .openapi('Child');

const ListResponseSchema = z.object({ data: z.array(ChildSchema) }).openapi('ChildrenListResponse');

const ErrorSchema = z.object({ error: z.string(), code: z.string() }).openapi('ChildrenError');

const app = new OpenAPIHono<AppEnv>();

// GET /api/me/children
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Me'],
    summary: '這個家長綁定的孩子清單',
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: ListResponseSchema } },
      },
      403: {
        description: '不是家長身分',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: {
        description: '伺服器錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    // 角色層擋不到這麼細（`/api/me` 對三個角色都開），這裡自己補一次。
    if (!(c.get('roles') ?? []).includes('parent')) {
      return c.json({ error: '不是家長身分', code: 'NOT_PARENT' }, 403);
    }

    const childDb = c.get('childDb');
    const { data, error } = await childDb.from('students', 'id').select('id, name, grade, school');

    if (error) {
      console.error('[me/children] 查詢孩子清單失敗:', error);
      return c.json({ error: '讀取孩子清單失敗', code: 'FETCH_CHILDREN_FAILED' }, 500);
    }

    return c.json({ data: (data ?? []) as unknown as z.infer<typeof ChildSchema>[] }, 200);
  },
);

export default app;
