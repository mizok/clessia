import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

const AttendanceModeSchema = z.enum(['per_session', 'daily_checkin']).openapi('AttendanceMode');

const AttendanceResponsibleSchema = z.enum(['admin', 'teacher']).openapi('AttendanceResponsible');

/** 插班／退班比例試算的基準。預設 days —— 按天永遠算得出來，按堂依賴 sessions 已生成 */
const ProrationBasisSchema = z.enum(['days', 'sessions']).openapi('ProrationBasis');

const OrgSettingsSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    attendanceMode: AttendanceModeSchema,
    attendanceResponsible: AttendanceResponsibleSchema,
    attendanceRetroactiveDays: z.number().int().min(0),
    /** 開帳時 due_date 的預設天數（規則 7：對齊發袋後兩三週的節奏） */
    invoiceDueDays: z.number().int().min(0),
    /** 餐費的預設單價。單價存在每一筆餐記錄上，這只是開單時的起始值 */
    mealDefaultPrice: z.number().int().min(0),
    prorationBasis: ProrationBasisSchema,
  })
  .openapi('OrgSettings');

const UpdateOrgSettingsSchema = z
  .object({
    attendanceMode: AttendanceModeSchema.optional(),
    attendanceResponsible: AttendanceResponsibleSchema.optional(),
    attendanceRetroactiveDays: z.coerce.number().int().min(0).optional(),
    invoiceDueDays: z.coerce.number().int().min(0).optional(),
    mealDefaultPrice: z.coerce.number().int().min(0).optional(),
    prorationBasis: ProrationBasisSchema.optional(),
  })
  .openapi('UpdateOrgSettings');

export function toOrgSettingsResponse(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    attendanceMode: row['attendance_mode'] as 'per_session' | 'daily_checkin',
    attendanceResponsible: (row['attendance_responsible'] as 'admin' | 'teacher') ?? 'admin',
    attendanceRetroactiveDays: (row['attendance_retroactive_days'] as number) ?? 0,
    invoiceDueDays: (row['invoice_due_days'] as number) ?? 14,
    mealDefaultPrice: Number(row['meal_default_price'] ?? 0),
    prorationBasis: (row['proration_basis'] as 'days' | 'sessions') ?? 'days',
  };
}

const app = new OpenAPIHono<AppEnv>();

const SELECT_FIELDS =
  'id, name, attendance_mode, attendance_responsible, attendance_retroactive_days, invoice_due_days, meal_default_price, proration_basis';

// GET /api/org/settings
app.openapi(
  createRoute({
    method: 'get',
    path: '/settings',
    tags: ['Org'],
    summary: '取得組織設定',
    responses: {
      200: {
        description: '組織設定',
        content: { 'application/json': { schema: OrgSettingsSchema } },
      },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');

    const { data, error } = await supabase
      .from('organizations')
      .select(SELECT_FIELDS)
      .eq('id', orgId)
      .single();

    if (error || !data) {
      return c.json({ error: '讀取組織設定失敗' }, 500);
    }

    return c.json(toOrgSettingsResponse(data), 200);
  },
);

// PATCH /api/org/settings
app.openapi(
  createRoute({
    method: 'patch',
    path: '/settings',
    tags: ['Org'],
    summary: '更新組織設定',
    request: {
      body: { content: { 'application/json': { schema: UpdateOrgSettingsSchema } } },
    },
    responses: {
      200: {
        description: '更新後的組織設定',
        content: { 'application/json': { schema: OrgSettingsSchema } },
      },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const body = c.req.valid('json');

    const updates: Record<string, unknown> = {};
    if (body.attendanceMode !== undefined) updates['attendance_mode'] = body.attendanceMode;
    if (body.attendanceResponsible !== undefined)
      updates['attendance_responsible'] = body.attendanceResponsible;
    if (body.attendanceRetroactiveDays !== undefined)
      updates['attendance_retroactive_days'] = body.attendanceRetroactiveDays;
    if (body.invoiceDueDays !== undefined) updates['invoice_due_days'] = body.invoiceDueDays;
    if (body.mealDefaultPrice !== undefined) updates['meal_default_price'] = body.mealDefaultPrice;
    if (body.prorationBasis !== undefined) updates['proration_basis'] = body.prorationBasis;

    const { data, error } = await supabase
      .from('organizations')
      .update(updates)
      .eq('id', orgId)
      .select(SELECT_FIELDS)
      .single();

    if (error || !data) {
      return c.json({ error: '更新組織設定失敗' }, 500);
    }

    return c.json(toOrgSettingsResponse(data), 200);
  },
);

export default app;
