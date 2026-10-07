import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';
import { waitUntilFrom } from '../lib/wait-until';
import { DbUuidSchema } from '../lib/validation';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

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
    id: DbUuidSchema,
    orgId: DbUuidSchema,
    name: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('BillingPeriod');

const BillingPeriodListItemSchema = BillingPeriodSchema.extend({
  /**
   * 與這期日期重疊的在讀期繳報名數（#1314 F4，計畫席裁 (i)）。報名跟期間沒有 FK，
   * 重疊條件同「待開單」（`upcoming-unbilled` 的 `pending`）。**它不代表刪不掉** ——
   * 擋刪除的是已開的帳單明細（`invoice_items`）。
   */
  overlappingEnrollmentCount: z.number().int(),
}).openapi('BillingPeriodListItem');

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
          'application/json': { schema: z.object({ data: z.array(BillingPeriodListItemSchema) }) },
        },
      },
      500: { description: '查詢失敗', content: { 'application/json': { schema: ErrorSchema } } },
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

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    // 每期一支 head count，讓 DB 數 —— 撈列回來數會被 max_rows（1000）靜默截斷
    const counts = await Promise.all(
      rows.map((row) =>
        supabase
          .from('enrollments')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('status', 'active')
          .eq('billing_mode', 'period')
          .lte('effective_from', row['end_date'] as string)
          .or(`effective_to.is.null,effective_to.gte.${row['start_date'] as string}`),
      ),
    );
    // 數不出來就不回 0（看起來像「沒人在用」）
    if (counts.some((r) => r.error)) {
      return c.json({ error: '查詢報名數失敗', code: 'DB_ERROR' }, 500);
    }

    return c.json(
      {
        data: rows.map((row, i) => ({
          ...mapBillingPeriod(row),
          overlappingEnrollmentCount: counts[i]!.count ?? 0,
        })),
      },
      200,
    );
  },
);

// ============================================================
// GET /api/billing-periods/upcoming-unbilled —— 儀表板「待開單」（#1293）
// ============================================================
//
// 系統沒有排程、也沒有 `billing_runs` 表（開單是無狀態的，直接產出帳單），所以行政不會被提醒
// 「下期快到了還沒開單」。這支在儀表板載入時算：
//   今天 < 期的開始日 ≤ 今天 + N 天（N＝機構設定 `organizations.billing_reminder_days`，預設 14，#1305），**而且**有該開的（在讀的期繳報名與這期重疊 —— 同期 run 的
//   `planTuitionItems` 撈的對象），**而且**還沒開（這期沒有任何一筆未作廢的學費明細）。
// 開過一次之後才有新報名的「增量」不在這支（#1100 billing-run 增量那條）。
//
// 讀不到設定（欄位還沒套、查詢失敗）退回原本的 14 天
const DEFAULT_REMINDER_DAYS = 14;

const UpcomingUnbilledSchema = z
  .object({
    periodId: DbUuidSchema,
    name: z.string(),
    startDate: z.string(),
    /** 距離開始還有幾天（1 = 明天） */
    daysUntil: z.number().int(),
    /** 這期該開、還沒開的期繳報名數 */
    pendingEnrollmentCount: z.number().int(),
  })
  .openapi('UpcomingUnbilledPeriod');

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

app.openapi(
  createRoute({
    method: 'get',
    path: '/upcoming-unbilled',
    tags: ['BillingPeriods'],
    summary: '機構設定天數內開始、有期繳生卻還沒開單的期',
    responses: {
      200: {
        description: '待開單的期（通常 0 或 1 筆），依開始日排序',
        content: {
          'application/json': { schema: z.object({ data: z.array(UpcomingUnbilledSchema) }) },
        },
      },
      500: { description: '查詢失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const today = getCurrentTaipeiDateString();
    const failed = () => c.json({ error: '查詢待開單失敗', code: 'DB_ERROR' }, 500);

    // 待辦要能顯示，跟「能不能改這個數字」（manage_finance）是兩件事 —— 這裡直接讀自己 org 的設定
    const { data: org } = await supabase
      .from('organizations')
      .select('billing_reminder_days')
      .eq('id', orgId)
      .maybeSingle();
    const reminderDays =
      ((org as { billing_reminder_days?: number } | null)?.billing_reminder_days ?? 0) ||
      DEFAULT_REMINDER_DAYS;

    const { data: periodRows, error: periodError } = await supabase
      .from('billing_periods')
      .select('id, name, start_date, end_date')
      .eq('org_id', orgId)
      .gt('start_date', today)
      .lte('start_date', addDays(today, reminderDays))
      .order('start_date', { ascending: true });
    if (periodError) return failed();
    const periods = (periodRows ?? []) as Array<{
      id: string;
      name: string;
      start_date: string;
      end_date: string;
    }>;
    if (periods.length === 0) return c.json({ data: [] }, 200);

    const [enrollmentResult, billedResult] = await Promise.all([
      supabase
        .from('enrollments')
        .select('effective_from, effective_to')
        .eq('org_id', orgId)
        .eq('status', 'active')
        .eq('billing_mode', 'period'),
      // invoice_items 沒有 org_id，經 invoices 篩；作廢的帳單不算開過（同 billing-runs 的 alreadyBilled）
      supabase
        .from('invoice_items')
        .select('billing_period_id, invoices!inner(org_id, voided_at)')
        .eq('invoices.org_id', orgId)
        .in(
          'billing_period_id',
          periods.map((p) => p.id),
        ),
    ]);
    if (enrollmentResult.error || billedResult.error) return failed();

    const billed = new Set(
      ((billedResult.data ?? []) as Array<Record<string, unknown>>)
        .filter((row) => {
          const invoice = row['invoices'];
          const one = (Array.isArray(invoice) ? invoice[0] : invoice) as {
            voided_at?: string | null;
          } | null;
          return !one?.voided_at;
        })
        .map((row) => row['billing_period_id'] as string),
    );
    const enrollments = (enrollmentResult.data ?? []) as Array<{
      effective_from: string;
      effective_to: string | null;
    }>;

    const data = periods.flatMap((period) => {
      if (billed.has(period.id)) return [];
      const pending = enrollments.filter(
        (e) =>
          e.effective_from <= period.end_date &&
          (!e.effective_to || e.effective_to >= period.start_date),
      ).length;
      if (pending === 0) return [];
      return [
        {
          periodId: period.id,
          name: period.name,
          startDate: period.start_date,
          daysUntil: daysBetween(today, period.start_date),
          pendingEnrollmentCount: pending,
        },
      ];
    });

    return c.json({ data }, 200);
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
      params: z.object({ id: DbUuidSchema }),
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
