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
    /**
     * 學校名。**`null` = 這個學生沒有指定學校**（`students.school_id` 是 nullable）。
     * 不回 `''` —— 空字串會讓「沒設定」跟「學校叫做空字串」長得一樣，
     * 而畫面要決定的是「要不要顯示這一行」。
     */
    school: z.string().nullable(),
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
    // ⚠️ **不能 select 裸 `school`** —— 那個欄位在
    // `20260421000003_seed_schools_from_students.sql:37` 就被 `DROP COLUMN` 了，
    // 取代它的是 `school_id` FK。這支端點一直沒跟著改，所以**對每一個家長、
    // 每一次呼叫都回 500**（`42703: column students.school does not exist`）。
    //
    // 它活到今天是因為兩個缺陷互相遮蔽：欄位被砍掉沒人改，而 seed 裡
    // `parent` 角色是 0 所以沒有人打得開家長端的任何一頁。
    // 見 issue #528。
    const { data, error } = await childDb
      .from('students', 'id')
      .select('id, name, grade, schools(name)');

    if (error) {
      console.error('[me/children] 查詢孩子清單失敗:', error);
      return c.json({ error: '讀取孩子清單失敗', code: 'FETCH_CHILDREN_FAILED' }, 500);
    }

    const rows = (data ?? []) as unknown as Array<{
      id: string;
      name: string;
      grade: string;
      // PostgREST 的巢狀關聯可能回物件也可能回陣列
      schools?: { name?: string | null } | Array<{ name?: string | null }> | null;
    }>;

    return c.json(
      {
        data: rows.map((row) => {
          const school = Array.isArray(row.schools) ? row.schools[0] : row.schools;

          return {
            id: row.id,
            name: row.name,
            grade: row.grade,
            school: school?.name ?? null,
          };
        }),
      },
      200,
    );
  },
);

export default app;
