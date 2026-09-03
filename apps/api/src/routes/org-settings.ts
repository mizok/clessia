import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { writeRequiresAdmin } from '../middleware/auth';
import { hasPermission } from '../lib/permissions';

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
    // 下面三個是**財務設定**，只回給有 `manage_finance` 的管理員。
    // 老師與其他管理員拿到的回應裡沒有這幾個 key —— 不是 0、不是 null，是不存在，
    // 因為「餐費單價是 0」跟「你不該知道餐費單價」是兩件不同的事。
    /** 開帳時 due_date 的預設天數（規則 7：對齊發袋後兩三週的節奏） */
    invoiceDueDays: z.number().int().min(0).optional(),
    /** 餐費的預設單價。單價存在每一筆餐記錄上，這只是開單時的起始值 */
    mealDefaultPrice: z.number().int().min(0).optional(),
    prorationBasis: ProrationBasisSchema.optional(),
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

/**
 * 這幾個 key 只給有 `manage_finance` 的人。
 *
 * **它們目前在這支端點是零消費者**：沒有任何畫面讀或編輯，而真正需要它們的
 * `meals.ts` / `invoices.ts` / `billing-runs.ts` / `lib/proration.ts` 是直接讀
 * `organizations` 那張表。所以在這裡發給每一個老師，換不到任何東西。
 */
export const FINANCE_SETTING_KEYS = [
  'invoiceDueDays',
  'mealDefaultPrice',
  'prorationBasis',
] as const;

export function toOrgSettingsResponse(row: Record<string, unknown>, includeFinance = true) {
  const base = {
    id: row['id'] as string,
    name: row['name'] as string,
    attendanceMode: row['attendance_mode'] as 'per_session' | 'daily_checkin',
    attendanceResponsible: (row['attendance_responsible'] as 'admin' | 'teacher') ?? 'admin',
    attendanceRetroactiveDays: (row['attendance_retroactive_days'] as number) ?? 0,
  };

  if (!includeFinance) return base;

  return {
    ...base,
    invoiceDueDays: (row['invoice_due_days'] as number) ?? 14,
    mealDefaultPrice: Number(row['meal_default_price'] ?? 0),
    prorationBasis: (row['proration_basis'] as 'days' | 'sessions') ?? 'days',
  };
}

/** 這次更新有沒有動到財務設定 —— 有的話要 `manage_finance`，不是 `manage_org_settings`。 */
export function touchesFinanceSettings(body: Record<string, unknown>): boolean {
  return FINANCE_SETTING_KEYS.some((key) => body[key] !== undefined);
}

const app = new OpenAPIHono<AppEnv>();

// 讀是全域的（老師要知道自己的點名時窗、儀表板要知道 attendanceMode），
// 但**改組織設定只有管理員、而且要有 manage_org_settings**。
// 這一行原本不存在 —— 見 kb/wiki/architecture/authorization-scope.md 洞 1。
app.use('/settings', writeRequiresAdmin('manage_org_settings'));

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

    return c.json(
      toOrgSettingsResponse(data, hasPermission(c.get('permissions') ?? [], 'manage_finance')),
      200,
    );
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

    // 餐費單價、開帳天數、比例分攤基準是**財務設定** —— 改它們要 `manage_finance`，
    // 不是管組織設定的那個權限。任課老師本來就不該碰餐費，而負責點名規則的行政
    // 也不見得該動價目。
    if (
      touchesFinanceSettings(body) &&
      !hasPermission(c.get('permissions') ?? [], 'manage_finance')
    ) {
      return c.json({ error: '需要「財務管理」才能修改收費相關設定', code: 'FORBIDDEN' }, 403);
    }

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

    return c.json(
      toOrgSettingsResponse(data, hasPermission(c.get('permissions') ?? [], 'manage_finance')),
      200,
    );
  },
);

export default app;
