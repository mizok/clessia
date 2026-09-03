import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';
import { waitUntilFrom } from '../lib/wait-until';

/**
 * 收費期間：機構自訂的具名日期區間（「2026 上學期 + 暑假」）。
 *
 * **「期」不是 enum。** 受訪公司一年兩期，但別的機構可能一年一期或照學期制 ——
 * 寫死成 enum 等於把一家補習班的行事曆刻進 schema。見 kb/wiki/rules/billing-rules.md 規則 1。
 *
 * **沒有分頁。** 一個機構的收費期間是個位數到十幾筆（一年兩期，放十年也才二十筆），
 * 分頁在這裡只會增加前端的狀態。真的長到需要分頁時再加。
 */

// ============================================================
// Schemas
// ============================================================

const BillingPeriodSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    name: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('BillingPeriod');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string().optional() })
  .openapi('BillingPeriodError');

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 單一區間自己合不合理。**刻意只看這一筆** —— 期間之間可以重疊：過渡期間（舊制最後
 * 一期與新制第一期）重疊是真實情境，擋掉它只會讓行政去改日期硬湊。
 */
export function isValidPeriodRange(startDate: string, endDate: string): boolean {
  return endDate >= startDate;
}

const CreateBillingPeriodSchema = z
  .object({
    name: z.string().min(1).max(100).openapi({ example: '2026 上學期 + 暑假' }),
    startDate: z.string().regex(DATE).openapi({ example: '2026-02-01' }),
    endDate: z.string().regex(DATE).openapi({ example: '2026-08-31' }),
  })
  .refine((v) => isValidPeriodRange(v.startDate, v.endDate), {
    message: '結束日不得早於開始日',
    path: ['endDate'],
  })
  .openapi('CreateBillingPeriod');

const UpdateBillingPeriodSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    startDate: z.string().regex(DATE).optional(),
    endDate: z.string().regex(DATE).optional(),
  })
  .openapi('UpdateBillingPeriod');

function mapBillingPeriod(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    name: row['name'] as string,
    startDate: row['start_date'] as string,
    endDate: row['end_date'] as string,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

const app = new OpenAPIHono<AppEnv>();

// ============================================================
// GET /api/billing-periods
// ============================================================
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['BillingPeriods'],
    summary: '收費期間列表',
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': { schema: z.object({ data: z.array(BillingPeriodSchema) }) },
        },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');

    const { data, error } = await supabase
      .from('billing_periods')
      .select('*')
      .eq('org_id', orgId)
      .order('start_date', { ascending: false });

    if (error) {
      return c.json({ data: [] }, 200);
    }

    return c.json({ data: (data ?? []).map((row) => mapBillingPeriod(row)) }, 200);
  },
);

// ============================================================
// POST /api/billing-periods
// ============================================================
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['BillingPeriods'],
    summary: '新增收費期間',
    request: {
      body: { content: { 'application/json': { schema: CreateBillingPeriodSchema } } },
    },
    responses: {
      201: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: BillingPeriodSchema }) } },
      },
      409: {
        description: '名稱重複',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      400: { description: '驗證錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    const { data, error } = await supabase
      .from('billing_periods')
      .insert({
        org_id: orgId,
        name: body.name,
        start_date: body.startDate,
        end_date: body.endDate,
      })
      .select('*')
      .single();

    if (error || !data) {
      if (error?.code === '23505') {
        return c.json({ error: '已有同名的收費期間', code: 'DUPLICATE' }, 409);
      }
      return c.json({ error: error?.message ?? '建立失敗', code: 'DB_ERROR' }, 400);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'billing_period',
        resourceId: data['id'] as string,
        resourceName: data['name'] as string,
        action: 'create',
      },
      waitUntilFrom(c),
    );

    return c.json({ data: mapBillingPeriod(data) }, 201);
  },
);

// ============================================================
// PUT /api/billing-periods/:id
// ============================================================
app.openapi(
  createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['BillingPeriods'],
    summary: '更新收費期間',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: UpdateBillingPeriodSchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: BillingPeriodSchema }) } },
      },
      400: { description: '驗證錯誤', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '不存在', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: '名稱重複', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const { data: existing } = await supabase
      .from('billing_periods')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!existing) {
      return c.json({ error: '收費期間不存在', code: 'NOT_FOUND' }, 404);
    }

    // 部分更新也要檢查區間 —— 只改 endDate 一樣可能把它推到 startDate 之前
    const startDate = body.startDate ?? (existing['start_date'] as string);
    const endDate = body.endDate ?? (existing['end_date'] as string);
    if (!isValidPeriodRange(startDate, endDate)) {
      return c.json({ error: '結束日不得早於開始日', code: 'INVALID_RANGE' }, 400);
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates['name'] = body.name;
    if (body.startDate !== undefined) updates['start_date'] = body.startDate;
    if (body.endDate !== undefined) updates['end_date'] = body.endDate;

    const { data, error } = await supabase
      .from('billing_periods')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();

    if (error || !data) {
      if (error?.code === '23505') {
        return c.json({ error: '已有同名的收費期間', code: 'DUPLICATE' }, 409);
      }
      return c.json({ error: error?.message ?? '更新失敗', code: 'DB_ERROR' }, 400);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'billing_period',
        resourceId: id,
        resourceName: data['name'] as string,
        action: 'update',
      },
      waitUntilFrom(c),
    );

    return c.json({ data: mapBillingPeriod(data) }, 200);
  },
);

// ============================================================
// DELETE /api/billing-periods/:id
// ============================================================
app.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['BillingPeriods'],
    summary: '刪除收費期間',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      404: { description: '不存在', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: '已被引用', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');

    const { data: existing } = await supabase
      .from('billing_periods')
      .select('name')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!existing) {
      return c.json({ error: '收費期間不存在', code: 'NOT_FOUND' }, 404);
    }

    const { error } = await supabase
      .from('billing_periods')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);

    if (error) {
      // 23503 = FK 違反。帳單開始引用期間之後（P2）會走到這裡
      if (error.code === '23503') {
        return c.json({ error: '這個期間已被使用，無法刪除', code: 'IN_USE' }, 409);
      }
      return c.json({ error: error.message, code: 'DB_ERROR' }, 409);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'billing_period',
        resourceId: id,
        resourceName: existing['name'] as string,
        action: 'delete',
      },
      waitUntilFrom(c),
    );

    return c.json({ success: true }, 200);
  },
);

export default app;
