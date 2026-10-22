import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { waitUntilFrom } from '../lib/wait-until';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';
import { monthRange } from '../lib/proration';
import {
  detectEnrollmentsWithoutBillingMode,
  detectMealItemAnomalies,
  groupByStudent,
  planTuitionItems,
  type EnrollmentBillingModeCheck,
  type MealItemAnomaly,
  type TuitionCandidate,
} from '../lib/billing-run';
import { DbUuidSchema } from '../lib/validation';
import { getCampusScope, type CampusScope } from '../lib/campus-scope';
import { INVOICE_SCOPE_EMBED, invoiceInScope } from '../lib/invoice-campus-scope';
import { addDaysToDateString, getCurrentTaipeiDateString } from '../lib/taipei-date';
import { fetchAllPages } from '../lib/fetch-all-pages';
import type { Queryable } from '../lib/identity-sql';
import {
  alreadyBilledViaSql,
  mealStudentsInScopeViaSql,
  stampedTotalsViaSql,
  unbilledMealStudentsViaSql,
} from '../lib/billing-run-sql';

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
 *
 * **分校範圍（#1393）**：受限的管理員跑的是「自己分校那一份」—— 學費只挑班在範圍內的報名、
 * 餐費只開 `studentInScope` 的學生，於是開出的每張帳單必然 `invoiceInScope`。判準住在
 * `lib/invoice-campus-scope.ts`，這裡不另寫。跨校學生被兩校各自 run 會拿到兩張單（計畫席 10-10 過）。
 * 異常掃描與 repair 也只看、只修範圍內的帳單。`scope === null` 時查詢跟改之前一字不差。
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * **讀取失敗一律中止，不能當成「沒有資料」繼續**（#1934）。
 *
 * 這裡每一段讀取的結果都會直接決定要寫什麼：學費冪等查詢讀成空的 → 已開過的報名整批再開一次
 * （`invoice_items` 沒有 UNIQUE 擋）；蓋章總額讀成空的 → 每筆應收都是 0 → repair 把餐費改成 0。
 * 原本每支只拿 `data`、不看 `error`，`.in()` 帶上千個 id 回 414 時就是走到這兩條。
 * 所以讀取一出錯就丟這個，handler 在**寫入之前**接住、回 500，一筆都不寫。
 */
class ReadFailed extends Error {
  constructor(
    readonly step: string,
    cause: { message?: string; code?: string },
  ) {
    super(`${step}：${cause.message ?? 'unknown'}`);
  }
}

function mustRead<T>(
  step: string,
  res: { data: T; error: { message?: string; code?: string } | null },
): T {
  if (res.error) throw new ReadFailed(step, res.error);
  return res.data;
}

/** 撈到底（`max_rows` 1000 會靜默截斷，#1934）；任一頁失敗同 `mustRead` */
async function mustReadAll(
  step: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<Record<string, unknown>[]> {
  const { rows, error } = await fetchAllPages(page);
  if (error) throw new ReadFailed(step, error as { message?: string; code?: string });
  return rows;
}

/** pg 那條的例外也當成讀取失敗：在寫入之前中止 */
async function sqlRead<T>(step: string, run: Promise<T>): Promise<T> {
  try {
    return await run;
  } catch (err) {
    throw new ReadFailed(step, {
      message: err instanceof Error ? err.message : String(err),
      code: (err as { code?: string })?.code,
    });
  }
}

const READ_FAILED_BODY = {
  error: '讀取帳務資料失敗，這次沒有寫入任何資料，請稍後再試',
  code: 'READ_FAILED',
} as const;

const AnomalySchema = z
  .object({
    invoiceItemId: DbUuidSchema,
    itemAmount: z.number(),
    stampedTotal: z.number(),
    expectedAmount: z.number(),
  })
  .openapi('BillingRunAnomaly');

const EnrollmentWithoutBillingModeSchema = z
  .object({ id: DbUuidSchema, studentId: DbUuidSchema, classId: DbUuidSchema })
  .openapi('EnrollmentWithoutBillingMode');

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
  scope: CampusScope,
  db: Queryable | undefined,
): Promise<MealItemAnomaly[]> {
  return (await scanMealItems(supabase, orgId, scope, db)).anomalies;
}

/** 同上，另外回這次掃了幾筆（repair 的比例防呆要用） */
async function scanMealItems(
  supabase: SupabaseClient,
  orgId: string,
  scope: CampusScope,
  db: Queryable | undefined,
): Promise<{ anomalies: MealItemAnomaly[]; scanned: number }> {
  const select: string =
    'id, amount, invoices!inner(org_id, voided_at' +
    (scope === null ? '' : INVOICE_SCOPE_EMBED) +
    ')';
  // 餐費明細每生每月一筆、只增不減，撈到底（分校範圍的判準 invoiceInScope 留在 TS）
  const mealItems = await mustReadAll('餐費明細', (from, to) =>
    supabase
      .from('invoice_items')
      .select(select)
      .eq('type', 'meal')
      .eq('invoices.org_id', orgId)
      .order('id')
      .range(from, to),
  );

  // 作廢單不掃（#898）：作廢時章已解，它的 item 必然「對不上」，
  // 放進來的話 repair 會去改一張作廢單（DB trigger 擋下 → 每次都回報一筆修不掉的異常）
  const items = ((mealItems ?? []) as unknown as Record<string, unknown>[]).filter((item) => {
    const invoice = item['invoices'] as Record<string, unknown> | null;
    return !invoice?.['voided_at'] && (scope === null || invoiceInScope(invoice ?? {}, scope));
  });
  if (items.length === 0) return { anomalies: [], scanned: 0 };

  const itemIds = items.map((item) => item['id'] as string);

  // 蓋章總額在 SQL 裡加總：id 走 bind 參數（不會 414），也沒有 1000 列截斷（#1934）。
  // 沒有 pool（單元測試的精簡 app）才走 REST；那條 id 多了照樣 414，但已經會回 500、不會改到錢
  let totals: Map<string, number>;
  if (db) {
    totals = await sqlRead('餐費蓋章總額', stampedTotalsViaSql(db, itemIds));
  } else {
    const stamped = await mustReadAll('餐費蓋章總額', (from, to) =>
      supabase
        .from('meal_records')
        .select('invoice_item_id, unit_price')
        .in('invoice_item_id', itemIds)
        .order('id')
        .range(from, to),
    );
    totals = new Map<string, number>();
    for (const row of stamped) {
      const key = row['invoice_item_id'] as string;
      totals.set(key, (totals.get(key) ?? 0) + Number(row['unit_price']));
    }
  }

  return {
    anomalies: detectMealItemAnomalies(
      items.map((item) => ({
        invoiceItemId: item['id'] as string,
        itemAmount: Number(item['amount']),
        stampedTotal: totals.get(item['id'] as string) ?? 0,
      })),
    ),
    scanned: items.length,
  };
}

/**
 * repair 的比例防呆（#1934）：**異常多到不像真的就不修**。
 *
 * 正常的異常只來自三步式月結死在中間，一次 run 頂多幾個學生。一大片同時「對不上」，比較可能是
 * 掃描本身讀錯了（#1934 就是蓋章總額讀成空的、整片判成應收 0），這時照修就是把正確的金額改掉。
 * 門檻：多於 3 筆**而且**超過掃描總數的 20%。擋下時回 409、一筆都不改，交給人看。
 * ponytail: 門檻是估的；真的遇到大量合法異常（例：某次 run 整批中斷），要加「確認後強制修補」的參數
 */
export const REPAIR_MAX_ABSOLUTE = 3;
export const REPAIR_MAX_RATIO = 0.2;
export function repairLooksWrong(anomalies: number, scanned: number): boolean {
  return anomalies > REPAIR_MAX_ABSOLUTE && anomalies > scanned * REPAIR_MAX_RATIO;
}

/**
 * 掃出「active 但**沒有計費模式**」的報名 —— 永遠不進任何 run 的那些（issue #638）。
 *
 * 跟 `scanMealAnomalies` 並列：兩者都是**少收、不會重複收、而且查得到**。
 * 差別是餐費那支查「開了但金額不對」，這支查「**根本沒被開過，而且不會被開**」。
 *
 * 範圍跟 run 挑報名的條件對齊（`status = 'active'`）—— 掃一個 run 不會碰的母體沒有意義。
 *
 * ⚠️ **不進 `/repair`**：餐費異常修得動（把金額改回蓋章總額，冪等），
 * 而「該用哪一種計費模式」是**人的決定**，沒有正確答案可以自動填。
 */
async function scanEnrollmentsWithoutBillingMode(
  supabase: SupabaseClient,
  orgId: string,
  scope: CampusScope,
): Promise<EnrollmentBillingModeCheck[]> {
  const select: string =
    'id, student_id, class_id, billing_mode' + (scope === null ? '' : ', classes!inner(campus_id)');
  const data = await mustReadAll('沒有計費模式的報名', (from, to) => {
    let query = supabase
      .from('enrollments')
      .select(select)
      .eq('org_id', orgId)
      .eq('status', 'active')
      .is('billing_mode', null);
    if (scope !== null) query = query.in('classes.campus_id', [...scope]);
    return query.order('id').range(from, to);
  });

  return detectEnrollmentsWithoutBillingMode(
    ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: row['id'] as string,
      studentId: row['student_id'] as string,
      classId: row['class_id'] as string,
      billingMode: (row['billing_mode'] as string | null) ?? null,
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
                billingPeriodId: DbUuidSchema.optional(),
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
              /**
               * **active 但沒有計費模式的報名**（#638）—— 非空代表有人永遠收不到錢。
               * 跟 `anomalies` 不同：那些是開了但金額不對，這些是**根本不會被開**。
               */
              enrollmentsWithoutBillingMode: z.array(EnrollmentWithoutBillingModeSchema),
            }),
          },
        },
      },
      400: { description: '錯誤', content: { 'application/json': { schema: ErrorSchema } } },
      404: {
        description: '收費期間不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: {
        description: '讀取失敗（沒有寫入），或開帳後的異常掃描失敗',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const scope = getCampusScope(c);
    const body = c.req.valid('json');

    const isMonthRun = Boolean(body.periodMonth);
    let range: { start: string; end: string };
    let billingPeriodId: string | null = null;
    let periodMonth: string | null = null;

    if (isMonthRun) {
      range = monthRange(body.periodMonth as string);
      periodMonth = range.start;
    } else {
      const { data: period, error: periodError } = await supabase
        .from('billing_periods')
        .select('id, start_date, end_date')
        .eq('id', body.billingPeriodId as string)
        .eq('org_id', orgId)
        .maybeSingle();
      // 讀不到 ≠ 不存在：錯誤時回 500，不是 404
      if (periodError) {
        console.error('[billing-runs] 收費期間讀取失敗:', periodError.message);
        return c.json(READ_FAILED_BODY, 500);
      }

      if (!period) {
        return c.json({ error: '收費期間不存在', code: 'NOT_FOUND' }, 404);
      }

      const row = period as Record<string, unknown>;
      range = { start: row['start_date'] as string, end: row['end_date'] as string };
      billingPeriodId = row['id'] as string;
    }

    // ── 開帳前的讀取：任何一段失敗都在寫入之前中止（#1934）──────────
    let plannedTuition: ReturnType<typeof planTuitionItems>;
    const mealStudents = new Set<string>();
    let dueDays: number;
    try {
      // pg 有就走 pg（帶一大串 id 的讀取、列數會破千的讀取）；沒有才走 REST（單元測試的精簡 app）
      const db = c.get('auth')?.pool;

      // ── 學費候選 ────────────────────────────────────────────
      // 受限者只挑班在範圍內的報名（空範圍 → `in.()` 零筆，fail-closed）。
      // 撈到底：大校的 active 報名會超過 1000 筆（#1934），少撈的那些這個月就沒開到
      const enrollmentSelect: string =
        'id, student_id, effective_from, effective_to, agreed_amount, fee_templates(amount)' +
        (scope === null ? '' : ', classes!inner(campus_id)');
      const enrollmentRows = await mustReadAll('學費候選報名', (from, to) => {
        let enrollmentQuery = supabase
          .from('enrollments')
          .select(enrollmentSelect)
          .eq('org_id', orgId)
          .eq('status', 'active')
          .eq('billing_mode', isMonthRun ? 'monthly' : 'period');
        if (scope !== null) enrollmentQuery = enrollmentQuery.in('classes.campus_id', [...scope]);
        return enrollmentQuery.order('id').range(from, to);
      });

      const candidates: TuitionCandidate[] = enrollmentRows.map((row) => ({
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
      // ⚠️ 這支少看到一筆就是重複開帳（invoice_items 沒有 UNIQUE 擋）。所以：id 不放網址（414）、
      // 列不能被 1000 截斷、讀不到就中止。作廢單上的學費列不算開過（#898 裁決 B）
      let alreadyBilled = new Set<string>();
      if (candidates.length > 0) {
        const enrollmentIds = candidates.map((candidate) => candidate.enrollmentId);
        if (db) {
          alreadyBilled = await sqlRead(
            '已開帳的學費（冪等）',
            alreadyBilledViaSql(db, { orgId, enrollmentIds, periodMonth, billingPeriodId }),
          );
        } else {
          const billedRows = await mustReadAll('已開帳的學費（冪等）', (from, to) => {
            const billedQuery = supabase
              .from('invoice_items')
              .select('enrollment_id, invoices!inner(voided_at)')
              .eq('type', 'tuition')
              .in('enrollment_id', enrollmentIds);
            return (
              periodMonth
                ? billedQuery.eq('period_month', periodMonth)
                : billedQuery.eq('billing_period_id', billingPeriodId as string)
            )
              .order('id')
              .range(from, to);
          });
          for (const row of billedRows) {
            if ((row['invoices'] as { voided_at?: string | null } | null)?.voided_at) continue;
            alreadyBilled.add(row['enrollment_id'] as string);
          }
        }
      }

      plannedTuition = planTuitionItems(candidates, alreadyBilled, range);

      // ── 餐費：只有月 run 處理，而且跟著月份走 ─────────────────
      if (isMonthRun) {
        // 一天一列：全校一個月輕鬆破千，所以在 SQL 取 distinct 學生
        const students = db
          ? await sqlRead(
              '待開餐費',
              unbilledMealStudentsViaSql(db, { orgId, start: range.start, end: range.end }),
            )
          : (
              await mustReadAll('待開餐費', (from, to) =>
                supabase
                  .from('meal_records')
                  .select('student_id')
                  .eq('org_id', orgId)
                  .gte('meal_date', range.start)
                  .lte('meal_date', range.end)
                  .eq('ordered', true)
                  .eq('chargeable', true)
                  .is('invoice_item_id', null)
                  .order('id')
                  .range(from, to),
              )
            ).map((row) => row['student_id'] as string);
        for (const studentId of students) mealStudents.add(studentId);

        // 餐費沒有分校（`meal_records` 無 campus_id）—— 受限者只開 `studentInScope` 的學生：
        // 任一報名（不分 status）的班在範圍內，同學生列表 `students.ts` 與單張開單
        if (scope !== null && mealStudents.size > 0) {
          const studentIds = [...mealStudents];
          const inScope = db
            ? await sqlRead(
                '餐費學生的分校',
                mealStudentsInScopeViaSql(db, { orgId, studentIds, scope }),
              )
            : new Set(
                (
                  await mustReadAll('餐費學生的分校', (from, to) =>
                    supabase
                      .from('enrollments')
                      .select('student_id, classes!inner(campus_id)')
                      .eq('org_id', orgId)
                      .in('student_id', studentIds)
                      .in('classes.campus_id', [...scope])
                      .order('id')
                      .range(from, to),
                  )
                ).map((row) => row['student_id'] as string),
              );
          for (const studentId of mealStudents) {
            if (!inScope.has(studentId)) mealStudents.delete(studentId);
          }
        }
      }

      const org = mustRead(
        '帳單期限設定',
        await supabase
          .from('organizations')
          .select('invoice_due_days')
          .eq('id', orgId)
          .maybeSingle(),
      );
      dueDays = Number((org as { invoice_due_days?: number } | null)?.invoice_due_days ?? 14);
    } catch (err) {
      if (!(err instanceof ReadFailed)) throw err;
      console.error(`[billing-runs] 開帳前讀取失敗，沒有寫入：${err.message}`);
      return c.json(READ_FAILED_BODY, 500);
    }

    const tuitionByStudent = groupByStudent(plannedTuition);
    const studentIds = new Set<string>([...tuitionByStudent.keys(), ...mealStudents]);

    // 沒有任何明細的學生根本不在這個集合裡 —— **不會開出空帳單**
    let invoicesCreated = 0;
    let tuitionItems = 0;
    let mealItems = 0;
    let mealRecordsSettled = 0;

    // 台北時間，不是 UTC —— 見 lib/taipei-date.ts 檔頭
    const issuedAt = getCurrentTaipeiDateString();
    let dueDate = body.dueDate ?? null;
    if (!dueDate) {
      // 純日曆字串運算，跟 addDaysToDateString 同一支邏輯，不要各自重寫一份
      dueDate = addDaysToDateString(issuedAt, dueDays);
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

    // 開帳已經寫完；這裡失敗不能當成「沒有異常」回 200。重跑 run 是冪等的（學費查衍生列、餐費靠蓋章）
    let anomalies: MealItemAnomaly[];
    let enrollmentsWithoutBillingMode: EnrollmentBillingModeCheck[];
    try {
      anomalies = await scanMealAnomalies(supabase, orgId, scope, c.get('auth')?.pool);
      enrollmentsWithoutBillingMode = await scanEnrollmentsWithoutBillingMode(
        supabase,
        orgId,
        scope,
      );
    } catch (err) {
      if (!(err instanceof ReadFailed)) throw err;
      console.error(`[billing-runs] 開帳後的異常掃描失敗：${err.message}`);
      return c.json(
        {
          error: `帳單已開立 ${invoicesCreated} 張，但異常掃描失敗，請到帳務異常頁重新掃描`,
          code: 'SCAN_FAILED_AFTER_RUN',
        },
        500,
      );
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'billing_run',
        resourceName: isMonthRun ? (periodMonth as string) : (billingPeriodId as string),
        action: 'run',
        details: {
          invoicesCreated,
          tuitionItems,
          mealItems,
          anomalies: anomalies.length,
          enrollmentsWithoutBillingMode: enrollmentsWithoutBillingMode.length,
        },
      },
      waitUntilFrom(c),
    );

    return c.json(
      {
        invoicesCreated,
        tuitionItems,
        mealItems,
        mealRecordsSettled,
        anomalies,
        enrollmentsWithoutBillingMode,
      },
      200,
    );
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
    summary: '少收錢的兩種狀態：餐費金額對不上、以及沒有計費模式的報名',
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(AnomalySchema),
              /** #638 —— 這一支是「查得到」的正主，所以新的偵測放這裡不只放 run 的回應 */
              enrollmentsWithoutBillingMode: z.array(EnrollmentWithoutBillingModeSchema),
            }),
          },
        },
      },
      500: {
        description: '讀取失敗',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const scope = getCampusScope(c);
    try {
      const anomalies = await scanMealAnomalies(supabase, orgId, scope, c.get('auth')?.pool);
      const enrollmentsWithoutBillingMode = await scanEnrollmentsWithoutBillingMode(
        supabase,
        orgId,
        scope,
      );
      return c.json({ data: anomalies, enrollmentsWithoutBillingMode }, 200);
    } catch (err) {
      if (!(err instanceof ReadFailed)) throw err;
      console.error(`[billing-runs] 異常掃描讀取失敗：${err.message}`);
      return c.json(READ_FAILED_BODY, 500);
    }
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
      409: {
        description: '對不上的筆數比例異常（多於 3 筆且超過掃描總數 20%），沒有修改',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: {
        description: '修補前的掃描讀取失敗（沒有修改），或修補後的重掃失敗',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const scope = getCampusScope(c);

    // 掃描讀不到就一筆都不改：讀成空的蓋章總額會把每筆應收算成 0（#1934）
    let anomalies: MealItemAnomaly[];
    let scanned: number;
    try {
      ({ anomalies, scanned } = await scanMealItems(supabase, orgId, scope, c.get('auth')?.pool));
    } catch (err) {
      if (!(err instanceof ReadFailed)) throw err;
      console.error(`[billing-runs] repair 前的掃描讀取失敗，沒有修改：${err.message}`);
      return c.json(READ_FAILED_BODY, 500);
    }

    if (repairLooksWrong(anomalies.length, scanned)) {
      console.error(
        `[billing-runs] repair 擋下：${anomalies.length}／${scanned} 筆對不上，比例異常，沒有修改`,
      );
      return c.json(
        {
          error: `${scanned} 筆餐費明細裡有 ${anomalies.length} 筆對不上，比例異常，這次沒有修改任何金額。請聯絡系統管理員確認`,
          code: 'REPAIR_RATIO_TOO_HIGH',
        },
        409,
      );
    }

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

    let remaining: MealItemAnomaly[];
    try {
      remaining = await scanMealAnomalies(supabase, orgId, scope, c.get('auth')?.pool);
    } catch (err) {
      if (!(err instanceof ReadFailed)) throw err;
      console.error(`[billing-runs] repair 後的重掃失敗：${err.message}`);
      return c.json(
        {
          error: `已修補 ${anomalies.length} 筆，但重新掃描失敗，請到帳務異常頁重掃`,
          code: 'SCAN_FAILED_AFTER_REPAIR',
        },
        500,
      );
    }
    return c.json({ repaired: anomalies.length, remaining }, 200);
  },
);

export default app;
