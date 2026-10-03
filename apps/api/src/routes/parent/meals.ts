import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { isChildAllowed } from '../../lib/child-scope';
import { DbUuidSchema } from '../../lib/validation';

/**
 * 家長端的餐費紀錄（#1117）。`/api/meals` 是 ADMIN_ONLY＋manage_finance，家長讀不到 —— 那是對的，
 * 這裡是另一支只看自己孩子的讀取端點（`childDb`，見 kb/wiki/architecture/parent-data-scope.md）。
 *
 * 計畫席 10-04 裁定（#1117 留言）：
 * - **只回 `ordered = true`**：沒訂的那天不是餐費，那是給行政查的（meal-rules 規則 1）
 * - **欄位 allowlist**：`note` 是行政的內部備註（收不收的人工裁量理由，meal-rules 規則 3）不回；
 *   結算只回「有沒有進帳單」，不回帳單 id
 * - **區間必填、最多 366 天、不分頁**：每生每日一筆（UNIQUE (student_id, meal_date)），
 *   366 天撞不到 PostgREST 的 max_rows 1000 —— `months` 的加總因此是完整的
 * - 規格的「餐別」不存在（rules 是每日一筆），以 rules 為準
 */

const MAX_RANGE_DAYS = 366;

const ParentMealRecordSchema = z
  .object({
    date: z.string(),
    unitPrice: z.number(),
    /** 行政可翻的「收不收」開關；不收的那天 `amount` 是 0 */
    chargeable: z.boolean(),
    amount: z.number(),
    /** 已經進帳單（月結蓋過章） */
    settled: z.boolean(),
  })
  .openapi('ParentMealRecord');

const ListResponseSchema = z
  .object({
    data: z.array(ParentMealRecordSchema),
    meta: z.object({
      /** 區間內每個月的筆數與金額加總，新到舊 —— 前端每月區塊的標題直接用 */
      months: z.array(
        z.object({ month: z.string(), count: z.number().int(), totalAmount: z.number() }),
      ),
    }),
  })
  .openapi('ParentMealListResponse');

const ErrorSchema = z.object({ error: z.string(), code: z.string() }).openapi('ParentMealError');

const app = new OpenAPIHono<AppEnv>();

// GET /api/me/meals
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Me'],
    summary: '這個孩子的餐費紀錄（區間必填，最多 366 天）',
    request: {
      query: z.object({
        childId: DbUuidSchema,
        dateFrom: z.string().date(),
        dateTo: z.string().date(),
      }),
    },
    responses: {
      200: {
        description: '有訂的每一天，日期新到舊',
        content: { 'application/json': { schema: ListResponseSchema } },
      },
      400: {
        description: '區間不合法',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      403: {
        description: '不是家長，或這個孩子不在家長範圍內',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '讀取失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (!(c.get('roles') ?? []).includes('parent')) {
      return c.json({ error: '不是家長身分', code: 'NOT_PARENT' }, 403);
    }

    const { childId, dateFrom, dateTo } = c.req.valid('query');

    if (!isChildAllowed(c.get('studentScope'), childId)) {
      return c.json({ error: '沒有這個孩子的權限', code: 'CHILD_OUT_OF_SCOPE' }, 403);
    }

    const days = (Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000;
    if (days < 0) {
      return c.json({ error: '結束日早於開始日', code: 'INVALID_RANGE' }, 400);
    }
    if (days >= MAX_RANGE_DAYS) {
      return c.json({ error: `區間最多 ${MAX_RANGE_DAYS} 天`, code: 'RANGE_TOO_WIDE' }, 400);
    }

    // scope 是「這個家長的所有孩子」—— 只靠它會把兄弟姊妹的混進來，所以 eq 這一個孩子
    const { data, error } = await c
      .get('childDb')
      .from('meal_records', 'student_id')
      .select('meal_date, unit_price, chargeable, invoice_item_id')
      .eq('student_id', childId)
      .eq('ordered', true)
      .gte('meal_date', dateFrom)
      .lte('meal_date', dateTo)
      .order('meal_date', { ascending: false });

    if (error) {
      return c.json({ error: '讀取餐費失敗', code: 'FETCH_MEALS_FAILED' }, 500);
    }

    const records = (
      (data ?? []) as unknown as Array<{
        meal_date: string;
        unit_price: number | string;
        chargeable: boolean;
        invoice_item_id: string | null;
      }>
    ).map((row) => {
      const unitPrice = Number(row.unit_price);
      return {
        date: row.meal_date,
        unitPrice,
        chargeable: row.chargeable,
        amount: row.chargeable ? unitPrice : 0,
        settled: row.invoice_item_id !== null,
      };
    });

    const byMonth = new Map<string, { count: number; totalAmount: number }>();
    for (const record of records) {
      const month = record.date.slice(0, 7);
      const acc = byMonth.get(month) ?? { count: 0, totalAmount: 0 };
      acc.count += 1;
      acc.totalAmount += record.amount;
      byMonth.set(month, acc);
    }

    return c.json(
      {
        data: records,
        meta: {
          months: [...byMonth]
            .sort(([a], [b]) => (a < b ? 1 : -1))
            .map(([month, acc]) => ({ month, ...acc })),
        },
      },
      200,
    );
  },
);

export default app;
