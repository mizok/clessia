import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';
import { waitUntilFrom } from '../lib/wait-until';
import { DbUuidSchema } from '../lib/validation';

/**
 * 價目表：org 層的定價，報名時挑選。
 *
 * **只給定價，不給折扣。** kb/wiki/rules/billing-rules.md 規則 2：折數看老闆當下心情、
 * 每個客人可能不一樣 —— 現實裡不存在結構化的折扣規則，只存在議價。所以這裡沒有任何
 * discount 欄位；實際談定的金額存在 `enrollments.agreed_amount`。
 *
 * **停用不刪除**：`is_active = false` 的價目表不出現在報名的選單裡，但留著讓歷史報名
 * 看得懂當初引用的是什麼。真的要刪的話 FK 是 RESTRICT，被引用過就刪不掉。
 *
 * 沒有分頁 —— 一個機構的價目表是十幾筆的量級，同 billing-periods。
 */

const BILLING_MODES = ['monthly', 'period', 'session_pack'] as const;

const FeeTemplateSchema = z
  .object({
    id: DbUuidSchema,
    orgId: DbUuidSchema,
    name: z.string(),
    billingMode: z.enum(BILLING_MODES),
    amount: z.number(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('FeeTemplate');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string().optional() })
  .openapi('FeeTemplateError');

const CreateFeeTemplateSchema = z
  .object({
    name: z.string().min(1).max(100).openapi({ example: '國中主科月繳' }),
    billingMode: z.enum(BILLING_MODES),
    // 台幣沒有小數 —— 整數存，避免「1000.00 vs 1000.0」的比對問題
    amount: z.number().int().min(0).openapi({ example: 4500 }),
    isActive: z.boolean().optional(),
  })
  .openapi('CreateFeeTemplate');

const UpdateFeeTemplateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    billingMode: z.enum(BILLING_MODES).optional(),
    amount: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .openapi('UpdateFeeTemplate');

const QueryParamsSchema = z.object({
  search: z.string().optional().openapi({ description: '搜尋名稱' }),
  isActive: z.string().optional().openapi({ description: 'true / false' }),
  billingMode: z.enum(BILLING_MODES).optional(),
});

/**
 * 把查詢參數翻成 supabase 的篩選值。抽出來是為了測得到 —— `isActive: false` 被當成
 * 「沒給」是這種轉換最典型的錯法。
 */
export function buildFeeTemplateFilters(params: {
  search?: string;
  isActive?: boolean;
  billingMode?: string;
}): {
  searchFilter: string | null;
  isActiveFilter: boolean | null;
  billingModeFilter: string | null;
} {
  return {
    searchFilter: params.search ? `%${params.search}%` : null,
    isActiveFilter: params.isActive === undefined ? null : params.isActive,
    billingModeFilter: params.billingMode ?? null,
  };
}

function mapFeeTemplate(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    name: row['name'] as string,
    billingMode: row['billing_mode'] as (typeof BILLING_MODES)[number],
    // numeric 從 postgrest 回來是字串
    amount: Number(row['amount']),
    isActive: row['is_active'] as boolean,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

const app = new OpenAPIHono<AppEnv>();

// ============================================================
// GET /api/fee-templates
// ============================================================
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['FeeTemplates'],
    summary: '價目表列表',
    request: { query: QueryParamsSchema },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: z.array(FeeTemplateSchema) }) } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const params = c.req.valid('query');

    const { searchFilter, isActiveFilter, billingModeFilter } = buildFeeTemplateFilters({
      search: params.search,
      isActive: params.isActive === undefined ? undefined : params.isActive === 'true',
      billingMode: params.billingMode,
    });

    let query = supabase.from('fee_templates').select('*').eq('org_id', orgId);

    if (searchFilter) query = query.ilike('name', searchFilter);
    if (isActiveFilter !== null) query = query.eq('is_active', isActiveFilter);
    if (billingModeFilter) query = query.eq('billing_mode', billingModeFilter);

    const { data, error } = await query.order('name');

    if (error) {
      return c.json({ data: [] }, 200);
    }

    return c.json({ data: (data ?? []).map((row) => mapFeeTemplate(row)) }, 200);
  },
);

// ============================================================
// POST /api/fee-templates
// ============================================================
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['FeeTemplates'],
    summary: '新增價目表',
    request: { body: { content: { 'application/json': { schema: CreateFeeTemplateSchema } } } },
    responses: {
      201: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: FeeTemplateSchema }) } },
      },
      400: { description: '驗證錯誤', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: '名稱重複', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    const insert: Record<string, unknown> = {
      org_id: orgId,
      name: body.name,
      billing_mode: body.billingMode,
      amount: body.amount,
    };
    if (body.isActive !== undefined) insert['is_active'] = body.isActive;

    const { data, error } = await supabase
      .from('fee_templates')
      .insert(insert)
      .select('*')
      .single();

    if (error || !data) {
      if (error?.code === '23505') {
        return c.json({ error: '已有同名的價目表', code: 'DUPLICATE' }, 409);
      }
      return c.json({ error: error?.message ?? '建立失敗', code: 'DB_ERROR' }, 400);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'fee_template',
        resourceId: data['id'] as string,
        resourceName: data['name'] as string,
        action: 'create',
      },
      waitUntilFrom(c),
    );

    return c.json({ data: mapFeeTemplate(data) }, 201);
  },
);

// ============================================================
// PUT /api/fee-templates/:id
// ============================================================
app.openapi(
  createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['FeeTemplates'],
    summary: '更新價目表',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: { content: { 'application/json': { schema: UpdateFeeTemplateSchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: FeeTemplateSchema }) } },
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

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates['name'] = body.name;
    if (body.billingMode !== undefined) updates['billing_mode'] = body.billingMode;
    if (body.amount !== undefined) updates['amount'] = body.amount;
    if (body.isActive !== undefined) updates['is_active'] = body.isActive;

    const { data, error } = await supabase
      .from('fee_templates')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: '已有同名的價目表', code: 'DUPLICATE' }, 409);
      }
      return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
    }

    if (!data) {
      return c.json({ error: '價目表不存在', code: 'NOT_FOUND' }, 404);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'fee_template',
        resourceId: id,
        resourceName: data['name'] as string,
        action: 'update',
      },
      waitUntilFrom(c),
    );

    return c.json({ data: mapFeeTemplate(data) }, 200);
  },
);

// ============================================================
// DELETE /api/fee-templates/:id
//
// 被報名引用過就刪不掉（FK 是 RESTRICT）—— 那時該做的是停用而不是刪除。
// ============================================================
app.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['FeeTemplates'],
    summary: '刪除價目表',
    request: { params: z.object({ id: DbUuidSchema }) },
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
      .from('fee_templates')
      .select('name')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!existing) {
      return c.json({ error: '價目表不存在', code: 'NOT_FOUND' }, 404);
    }

    const { error } = await supabase
      .from('fee_templates')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);

    if (error) {
      if (error.code === '23503') {
        return c.json({ error: '這份價目表已被報名引用，請改為停用', code: 'IN_USE' }, 409);
      }
      return c.json({ error: error.message, code: 'DB_ERROR' }, 409);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'fee_template',
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
