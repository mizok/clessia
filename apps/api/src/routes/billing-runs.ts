import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { waitUntilFrom } from '../lib/wait-until';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';
import { monthRange } from '../lib/proration';
import {
  detectMealItemAnomalies,
  groupByStudent,
  planTuitionItems,
  type MealItemAnomaly,
  type TuitionCandidate,
} from '../lib/billing-run';

/**
 * 每月／每期帳務作業。
 *
 * ⚠️ **冪等有兩種機制，不能互換**（完整說明在 `lib/billing-run.ts` 檔頭）：
 * 餐費在**來源列**蓋章（`meal_records.invoice_item_id`），學費查**衍生列**
 * （`invoice_items` 有沒有這個報名 × 這個週期）。搞混的後果是重複收費。
 *
 * **run 的參數決定計費對象**：
 *   - 月 run（`periodMonth`）→ `billing_mode = 'monthly'` 的報名 **+ 全體餐費**
 *   - 期 run（`billingPeriodId`）→ `billing_mode = 'period'` 且落在該期間的報名
 *   - `session_pack` **永遠不進 run** —— 買包時開帳，不是週期性的
 *
 * 餐費跟著**月份**走，跟學費的週期無關（meal-rules 規則 2：月底加總）。所以期繳的
 * 學生在非開帳月份也會收到一張只含餐費的小帳單 —— 收費袋本來就一個月發一次。
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const AnomalySchema = z
  .object({
    invoiceItemId: z.uuid(),
    itemAmount: z.number(),
    stampedTotal: z.number(),
    expectedAmount: z.number(),
  })
  .openapi('BillingRunAnomaly');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string().optional() })
  .openapi('BillingRunError');

/**
 * 掃出「item 金額對不上已蓋章餐記錄總額」的明細。
 *
 * 三步式月結（開 0 元 item → 蓋章並 RETURNING → 回填金額）死在中間時就會留下這種狀態。
 * **少收、永遠不會重複收**（蓋章才是閘門），而且**查得到** —— 這支就是那個「查得到」，
 * run 每次都會跑一遍，也有獨立端點可以隨時重跑。
 */
async function scanMealAnomalies(
  supabase: SupabaseClient,
  orgId: string,
): Promise<MealItemAnomaly[]> {
  const { data: mealItems } = await supabase
    .from('invoice_items')
    .select('id, amount, invoices!inner(org_id)')
    .eq('type', 'meal')
    .eq('invoices.org_id', orgId);

  const items = (mealItems ?? []) as unknown as Record<string, unknown>[];
  if (items.length === 0) return [];

  const itemIds = items.map((item) => item['id'] as string);

  const { data: stamped } = await supabase
    .from('meal_records')
    .select('invoice_item_id, unit_price')
    .in('invoice_item_id', itemIds);

  const totals = new Map<string, number>();
  for (const row of (stamped ?? []) as unknown as Record<string, unknown>[]) {
    const key = row['invoice_item_id'] as string;
    totals.set(key, (totals.get(key) ?? 0) + Number(row['unit_price']));
  }

  return detectMealItemAnomalies(
    items.map((item) => ({
      invoiceItemId: item['id'] as string,
      itemAmount: Number(item['amount']),
      stampedTotal: totals.get(item['id'] as string) ?? 0,
    })),
  );
}

const app = new OpenAPIHono<AppEnv>();

// ============================================================
// POST /api/billing-runs
// ============================================================
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['BillingRuns'],
    summary: '執行帳務作業（月或期）',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z
              .object({
                /** 月 run：`2026-03` 或 `2026-03-01` 都收 */
                periodMonth: z.string().optional(),
                /** 期 run */
                billingPeriodId: z.uuid().optional(),
                dueDate: z.string().regex(DATE).optional(),
              })
              .refine((v) => Boolean(v.periodMonth) !== Boolean(v.billingPeriodId), {
                message: 'periodMonth 與 billingPeriodId 二擇一',
              }),
          },
        },
      },
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({
              invoicesCreated: z.number(),
              tuitionItems: z.number(),
              mealItems: z.number(),
              mealRecordsSettled: z.number(),
              /** 三步式月結的安全網 —— 非空代表有 item 金額對不上蓋章總額 */
              anomalies: z.array(AnomalySchema),
            }),
          },
        },
      },
      400: { description: '錯誤', content: { 'application/json': { schema: ErrorSchema } } },
      404: {
        description: '收費期間不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    const isMonthRun = Boolean(body.periodMonth);
    let range: { start: string; end: string };
    let billingPeriodId: string | null = null;
    let periodMonth: string | null = null;

    if (isMonthRun) {
      range = monthRange(body.periodMonth as string);
      periodMonth = range.start;
    } else {
      const { data: period } = await supabase
        .from('billing_periods')
        .select('id, start_date, end_date')
        .eq('id', body.billingPeriodId as string)
        .eq('org_id', orgId)
        .maybeSingle();

      if (!period) {
        return c.json({ error: '收費期間不存在', code: 'NOT_FOUND' }, 404);
      }

      const row = period as Record<string, unknown>;
      range = { start: row['start_date'] as string, end: row['end_date'] as string };
      billingPeriodId = row['id'] as string;
    }

    // ── 學費候選 ────────────────────────────────────────────
    const { data: enrollmentRows } = await supabase
      .from('enrollments')
      .select('id, student_id, effective_from, effective_to, agreed_amount, fee_templates(amount)')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .eq('billing_mode', isMonthRun ? 'monthly' : 'period');

    const candidates: TuitionCandidate[] = (
      (enrollmentRows ?? []) as unknown as Record<string, unknown>[]
    ).map((row) => ({
      enrollmentId: row['id'] as string,
      studentId: row['student_id'] as string,
      // agreed_amount 優先 —— 議價是常態，價目表只是定價（規則 2）
      fullAmount: Number(
        row['agreed_amount'] ?? (row['fee_templates'] as { amount?: number } | null)?.amount ?? 0,
      ),
      effectiveFrom: row['effective_from'] as string,
      effectiveTo: (row['effective_to'] as string | null) ?? null,
    }));

    // ── 冪等：這個週期已經開過帳的報名 ──────────────────────
    const alreadyBilled = new Set<string>();
    if (candidates.length > 0) {
      let billedQuery = supabase
        .from('invoice_items')
        .select('enrollment_id')
        .eq('type', 'tuition')
        .in(
          'enrollment_id',
          candidates.map((candidate) => candidate.enrollmentId),
        );

      billedQuery = periodMonth
        ? billedQuery.eq('period_month', periodMonth)
        : billedQuery.eq('billing_period_id', billingPeriodId as string);

      const { data: billedRows } = await billedQuery;
      for (const row of (billedRows ?? []) as unknown as Record<string, unknown>[]) {
        alreadyBilled.add(row['enrollment_id'] as string);
      }
    }

    const plannedTuition = planTuitionItems(candidates, alreadyBilled, range);

    // ── 餐費：只有月 run 處理，而且跟著月份走 ─────────────────
    const mealStudents = new Set<string>();
    if (isMonthRun) {
      const { data: mealRows } = await supabase
        .from('meal_records')
        .select('student_id')
        .eq('org_id', orgId)
        .gte('meal_date', range.start)
        .lte('meal_date', range.end)
        .eq('ordered', true)
        .eq('chargeable', true)
        .is('invoice_item_id', null);

      for (const row of (mealRows ?? []) as unknown as Record<string, unknown>[]) {
        mealStudents.add(row['student_id'] as string);
      }
    }

    const tuitionByStudent = groupByStudent(plannedTuition);
    const studentIds = new Set<string>([...tuitionByStudent.keys(), ...mealStudents]);

    // 沒有任何明細的學生根本不在這個集合裡 —— **不會開出空帳單**
    let invoicesCreated = 0;
    let tuitionItems = 0;
    let mealItems = 0;
    let mealRecordsSettled = 0;

    const { data: org } = await supabase
      .from('organizations')
      .select('invoice_due_days')
      .eq('id', orgId)
      .maybeSingle();
    const dueDays = Number((org as { invoice_due_days?: number } | null)?.invoice_due_days ?? 14);

    const issuedAt = new Date().toISOString().slice(0, 10);
    let dueDate = body.dueDate ?? null;
    if (!dueDate) {
      const due = new Date(`${issuedAt}T00:00:00Z`);
      due.setUTCDate(due.getUTCDate() + dueDays);
      dueDate = due.toISOString().slice(0, 10);
    }

    for (const studentId of studentIds) {
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          org_id: orgId,
          student_id: studentId,
          issued_at: issuedAt,
          due_date: dueDate,
          note: isMonthRun ? `${periodMonth?.slice(0, 7)} 帳務作業` : '期繳帳務作業',
          created_by: userId,
        })
        .select('id')
        .single();

      if (invoiceError || !invoice) continue;
      const invoiceId = invoice['id'] as string;
      invoicesCreated += 1;

      const planned = tuitionByStudent.get(studentId) ?? [];
      if (planned.length > 0) {
        await supabase.from('invoice_items').insert(
          planned.map((item) => ({
            invoice_id: invoiceId,
            type: 'tuition',
            enrollment_id: item.enrollmentId,
            amount: item.amount,
            billing_period_id: billingPeriodId,
            period_month: periodMonth,
            note: item.note,
          })),
        );
        tuitionItems += planned.length;
      }

      if (!mealStudents.has(studentId)) continue;

      // ── 餐費的三步式 ──────────────────────────────────────
      // supabase-js 走 HTTP，一次呼叫一個交易，做不到 meal-rules 講的「同一
      // transaction」。而 FK 逼出順序：先有 item 才能蓋章。
      //
      // 所以拆三步，讓失敗落在安全的那邊：死在 2 之後、3 之前 → item 是 0 元但
      // 餐記錄已蓋章 → **少收，而且 scanMealAnomalies 查得到**。永遠不會重複收，
      // 因為蓋章才是閘門。
      //
      // 1. 開一筆 0 元的餐費 item
      const { data: mealItem } = await supabase
        .from('invoice_items')
        .insert({
          invoice_id: invoiceId,
          type: 'meal',
          amount: 0,
          period_month: periodMonth,
          note: `${periodMonth?.slice(0, 7)} 餐費`,
        })
        .select('id')
        .single();

      if (!mealItem) continue;
      const mealItemId = mealItem['id'] as string;
      mealItems += 1;

      // 2. 蓋章，並把金額帶回來
      const { data: stamped } = await supabase
        .from('meal_records')
        .update({ invoice_item_id: mealItemId })
        .eq('org_id', orgId)
        .eq('student_id', studentId)
        .gte('meal_date', range.start)
        .lte('meal_date', range.end)
        .eq('ordered', true)
        .eq('chargeable', true)
        .is('invoice_item_id', null)
        .select('unit_price');

      const rows = (stamped ?? []) as unknown as Record<string, unknown>[];
      const total = rows.reduce((sum, row) => sum + Number(row['unit_price']), 0);
      mealRecordsSettled += rows.length;

      // 3. 回填金額
      await supabase.from('invoice_items').update({ amount: total }).eq('id', mealItemId);
    }

    const anomalies = await scanMealAnomalies(supabase, orgId);

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'billing_run',
        resourceName: isMonthRun ? (periodMonth as string) : (billingPeriodId as string),
        action: 'run',
        details: { invoicesCreated, tuitionItems, mealItems, anomalies: anomalies.length },
      },
      waitUntilFrom(c),
    );

    return c.json({ invoicesCreated, tuitionItems, mealItems, mealRecordsSettled, anomalies }, 200);
  },
);

// ============================================================
// GET /api/billing-runs/anomalies —— 隨時重掃
// ============================================================
app.openapi(
  createRoute({
    method: 'get',
    path: '/anomalies',
    tags: ['BillingRuns'],
    summary: '餐費明細與蓋章總額對不上的清單',
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: z.array(AnomalySchema) }) } },
      },
    },
  }),
  async (c) => {
    const anomalies = await scanMealAnomalies(c.get('supabase'), c.get('orgId'));
    return c.json({ data: anomalies }, 200);
  },
);

// ============================================================
// POST /api/billing-runs/repair —— 把餐費 item 的金額修回蓋章總額
//
// 可重跑、冪等：金額已經對的不會被動到（`detectMealItemAnomalies` 只回不一致的）。
// ============================================================
app.openapi(
  createRoute({
    method: 'post',
    path: '/repair',
    tags: ['BillingRuns'],
    summary: '修補餐費明細金額',
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({ repaired: z.number(), remaining: z.array(AnomalySchema) }),
          },
        },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');

    const anomalies = await scanMealAnomalies(supabase, orgId);

    for (const anomaly of anomalies) {
      await supabase
        .from('invoice_items')
        .update({ amount: anomaly.expectedAmount })
        .eq('id', anomaly.invoiceItemId);
    }

    if (anomalies.length > 0) {
      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'billing_run',
          action: 'repair',
          details: { repaired: anomalies.length },
        },
        waitUntilFrom(c),
      );
    }

    return c.json(
      { repaired: anomalies.length, remaining: await scanMealAnomalies(supabase, orgId) },
      200,
    );
  },
);

export default app;
