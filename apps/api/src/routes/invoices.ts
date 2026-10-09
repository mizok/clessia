import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';
import { INVOICE_SELECT, toInvoiceResponse } from '../lib/invoice-query';
import { sliceDerivedPage } from '../lib/derived-page';
import { waitUntilFrom } from '../lib/wait-until';
import { DbUuidSchema } from '../lib/validation';
import { findInOrg, inOrg, missingInOrg } from '../lib/org-scope';
import { getCampusScope } from '../lib/campus-scope';
import {
  enrollmentsInScope,
  INVOICE_SCOPE_EMBED,
  invoiceInScope,
  studentInScope,
} from '../lib/invoice-campus-scope';
import { addDaysToDateString, getCurrentTaipeiDateString } from '../lib/taipei-date';
import { dueStateOn, whereDueWithin, whereOverdue } from '../lib/invoice-overdue';
import { summarizeInvoices } from '../lib/invoice-summary';
import {
  invoiceTotals,
  isOpenInvoice,
  type PaymentRow,
  voidBlockReason,
} from '../lib/invoice-status';

/**
 * 帳單、明細、收款、催繳。
 *
 * **狀態不是欄位**（`lib/invoice-status.ts`）。每一支會回傳帳單的端點都用同一組
 * 巢狀 select 把 items 與 payments 一起撈出來再推導 —— 不這樣做就會變成 N+1。
 *
 * 業務規則見 kb/wiki/rules/billing-rules.md。
 */

const ITEM_TYPES = ['tuition', 'meal', 'session_pack', 'adjustment'] as const;
const PAYMENT_KINDS = ['payment', 'refund'] as const;
const PAYMENT_METHODS = ['cash', 'transfer'] as const;
const REMINDER_METHODS = ['line', 'phone', 'other'] as const;
const INVOICE_STATUSES = ['unpaid', 'partial', 'paid', 'void', 'overrefunded'] as const;
const DUE_STATES = ['overdue', 'dueSoon', 'notDue'] as const;

/** 作廢單凍結（#898）。四支寫入共用的回應 —— DB trigger 另有一層，催繳那支沒有 */
const VOIDED = { error: '這張帳單已作廢，不能再修改', code: 'INVOICE_VOIDED' } as const;

const InvoiceItemSchema = z
  .object({
    id: DbUuidSchema,
    type: z.enum(ITEM_TYPES),
    enrollmentId: DbUuidSchema.nullable(),
    amount: z.number(),
    billingPeriodId: DbUuidSchema.nullable(),
    periodMonth: z.string().nullable(),
    note: z.string().nullable(),
  })
  .openapi('InvoiceItem');

const PaymentRecordSchema = z
  .object({
    id: DbUuidSchema,
    kind: z.enum(PAYMENT_KINDS),
    amount: z.number(),
    method: z.enum(PAYMENT_METHODS),
    paidAt: z.string(),
    proofPath: z.string().nullable(),
    receiptNo: z.number().nullable(),
    note: z.string().nullable(),
    recordedBy: z.string().nullable(),
  })
  .openapi('PaymentRecord');

const InvoiceSchema = z
  .object({
    id: DbUuidSchema,
    orgId: DbUuidSchema,
    studentId: DbUuidSchema,
    studentName: z.string().nullable(),
    issuedAt: z.string(),
    dueDate: z.string().nullable(),
    note: z.string().nullable(),
    /** 推導值，不是欄位 —— 唯一例外是 void，它來自 voided_at（#898） */
    status: z.enum(INVOICE_STATUSES),
    total: z.number(),
    /** 收款減退費 */
    netPaid: z.number(),
    voidedAt: z.string().nullable(),
    voidedBy: z.string().nullable(),
    voidReason: z.string().nullable(),
    items: z.array(InvoiceItemSchema),
    payments: z.array(PaymentRecordSchema),
    /** 最近一次催繳（#1314 P3）。只有列表帶；沒催過是 null */
    lastRemindedAt: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Invoice');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string().optional() })
  .openapi('InvoiceError');

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const app = new OpenAPIHono<AppEnv>();

const LIST_REMINDERS_EMBED = ', payment_reminders(created_at)';

/**
 * 列表的一列：帳單本體＋最近一次催繳時間（#1314 P3，列內「提醒」鈕要它）。
 * ponytail: 每張單的催繳全撈再取最大值（量級個位數）；上千筆時改 `referencedTable` 的 order＋limit 1。
 */
function toListedInvoice(row: Record<string, unknown>) {
  const reminders = (row['payment_reminders'] as Array<{ created_at: string }> | null) ?? [];
  // timestamptz 字串同格式同時區，字典序＝時間序
  const lastRemindedAt = reminders.reduce<string | null>(
    (latest, r) => (latest === null || r.created_at > latest ? r.created_at : latest),
    null,
  );
  return { ...toInvoiceResponse(row), lastRemindedAt };
}

/**
 * 撈到底：每頁 1000（= `max_rows`）、翻到不足一頁為止 —— 一次撈會被 `max_rows` 靜默截斷。
 * `page` 每次要回一支**新的** builder（照穩定排序切 range）。任一頁失敗就回 error，不回半套。
 *
 * ponytail: O(全部帳單) 每次呼叫 —— 上限是帳單總數；量大時升級成 DB 側 view／RPC（migration）。
 */
const PAGE = 1000;

async function fetchAllPages(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<{ rows: Array<Record<string, unknown>>; error: unknown }> {
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { rows, error };
    rows.push(...((data ?? []) as Array<Record<string, unknown>>));
    if ((data ?? []).length < PAGE) return { rows, error: null };
  }
}

/** 'YYYY-MM' → 下個月 1 號 'YYYY-MM-01' */
function nextMonthStart(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`;
}

/**
 * 以 id 取一張帳單，**org 與分校範圍都套**（#1381）。範圍外跟不存在一樣回 null → 路由回 404
 * （同 `findInOrg` 慣例：以 id 指名的單筆資源，不透露存在；計畫席 10-08 gate 裁定）。
 */
async function findScopedInvoice(
  c: Context<AppEnv>,
  id: string,
  columns: string,
): Promise<Record<string, unknown> | null> {
  const select: string = columns + INVOICE_SCOPE_EMBED;
  const { data } = await c
    .get('supabase')
    .from('invoices')
    .select(select)
    .eq('id', id)
    .eq('org_id', c.get('orgId'))
    .maybeSingle();
  const row = (data as Record<string, unknown> | null) ?? null;
  return row && invoiceInScope(row, getCampusScope(c)) ? row : null;
}

/**
 * body 指名的報名，班在範圍外的有沒有（#1381）—— 否則受限者可以往自己看得到的單塞別校明細。
 * 不受限時不查。查詢失敗丟（500），不折成「都在範圍內」。
 */
async function hasEnrollmentOutOfScope(
  c: Context<AppEnv>,
  enrollmentIds: readonly string[],
): Promise<boolean> {
  const scope = getCampusScope(c);
  if (scope === null || enrollmentIds.length === 0) return false;
  const { data, error } = await c
    .get('supabase')
    .from('enrollments')
    .select('id, classes(campus_id)')
    .eq('org_id', c.get('orgId'))
    .in('id', [...new Set(enrollmentIds)]);
  if (error) throw new Error(`hasEnrollmentOutOfScope failed: ${error.message}`);
  return !enrollmentsInScope(data ?? [], scope);
}

// ============================================================
// GET /api/invoices
//
// **分頁有兩條路徑，因為狀態是推導值。**
//
// `status`（未繳／部分繳／繳清）與 `overdue`（過了 due_date 且還沒繳清）都要先把
// items 與 payments 加總出來才知道，DB 濾不掉。帶了任一個就走「全撈 → 篩 → 自己切頁」；
// 那是行政要一張張處理的工作清單（數十筆的量級），不是無上限的歷史資料。
//
// 沒帶推導條件時走一般的 DB 分頁 —— 那條才是會長大的路徑，`total` 取 `count: 'exact'`。
//
// ⚠️ 兩條路徑的 `meta.total` 都必須是**篩後全體**的筆數。切頁之後才數是這裡踩過的坑：
// 除了最後一頁以外 total 永遠等於 pageSize，前端算出來的總頁數就永遠是 1 或 2。
// 推導那條的切頁固定在 `lib/derived-page.ts`，就是為了讓那個順序有地方被測。
// ============================================================
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Invoices'],
    summary: '帳單列表',
    request: {
      query: z.object({
        studentId: DbUuidSchema.optional(),
        overdue: z.string().optional().openapi({ description: 'true = 只看過期未繳清' }),
        outstanding: z
          .string()
          .optional()
          .openapi({ description: 'true = 只看未繳清（不看到期日）—— 催繳母體' }),
        dueWithin: z
          .string()
          .optional()
          .openapi({ description: '天數 N = 只看 N 天內到期且未繳清（今天與第 N 天都含）' }),
        status: z
          .enum(INVOICE_STATUSES)
          .optional()
          .openapi({ description: '推導出來的狀態，與 overdue 可並用' }),
        dueState: z.enum(DUE_STATES).optional().openapi({
          description:
            '未繳清的互斥章（#1314 P1）：overdue／dueSoon（7 天內，含今天）／notDue（之後或沒有到期日）。與 overdue／dueWithin 並用＝AND',
        }),
        issuedMonth: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional()
          .openapi({ description: 'YYYY-MM = 只看這個月開立的（匯出用，#1314 P4；同彙總「本月」的定義）' }),
        page: z.string().optional(),
        pageSize: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(InvoiceSchema),
              meta: z.object({ total: z.number(), page: z.number(), pageSize: z.number() }),
            }),
          },
        },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const params = c.req.valid('query');

    const page = Math.max(1, Number(params.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize ?? 20)));
    const overdue = params.overdue === 'true';
    const outstanding = params.outstanding === 'true';
    // 天數只收非負整數 —— 收不到就當沒帶，不要靜靜篩成空的（NaN 進日期運算會產出
    // 一個看起來像日期的字串，而那批清單會空得毫無訊號）
    const dueWithinRaw = params.dueWithin === undefined ? NaN : Number(params.dueWithin);
    const dueWithinDays =
      Number.isInteger(dueWithinRaw) && dueWithinRaw >= 0 ? dueWithinRaw : undefined;

    // 三者是同一個母體（未繳清）的子集,差別只在日期那一半:
    //   outstanding  沒有日期條件                 —— 催繳母體
    //   overdue      due_date < 今天              —— 已逾期
    //   dueWithin    今天 <= due_date <= 今天+N   —— 快到期
    // **「未繳清」那一半三者共用**,所以下面只有一個 isOpenInvoice。
    // dueState（#1314 P1）是同一個母體的互斥分章，判準在 lib/invoice-overdue 的 dueStateOn
    const unpaidOnly =
      overdue || outstanding || dueWithinDays !== undefined || params.dueState !== undefined;
    // 分校範圍（#1381）在記憶體判（`lib/invoice-campus-scope.ts`），所以受限者也走推導路徑
    const campusScope = getCampusScope(c);
    // 全都是推導條件 —— 帶了任一個就不能讓 DB 分頁，否則被篩掉的那些會在頁與頁之間留洞
    const derivedFilter = unpaidOnly || Boolean(params.status) || campusScope !== null;

    // 催繳時間只在管理端列表帶（#1314 P3）—— 不進共用的 INVOICE_SELECT，家長端也用它
    const select: string =
      INVOICE_SELECT + LIST_REMINDERS_EMBED + (campusScope === null ? '' : INVOICE_SCOPE_EMBED);
    const build = () => {
      let query = supabase
        .from('invoices')
        .select(select, derivedFilter ? undefined : { count: 'exact' })
        .eq('org_id', orgId);
      if (params.studentId) query = query.eq('student_id', params.studentId);
      // `issued_at` 是 date 欄（台北日期），月份直接比字串區間
      if (params.issuedMonth) {
        query = query
          .gte('issued_at', `${params.issuedMonth}-01`)
          .lt('issued_at', nextMonthStart(params.issuedMonth));
      }
      // 台北時間，不是 UTC —— 這是過濾條件不是預設值，算錯一天會讓整份清單的成員
      // 錯位（在台北凌晨看繳費頁，一批帳單會被錯誤地列為逾期或錯誤地不列，
      // 行政可能因此去催繳一個還沒到期的家長）。見 lib/taipei-date.ts 檔頭。
      // 「過了到期日沒」這條判斷本身在 lib/invoice-overdue.ts —— 營收報表用的是同一支。
      if (overdue) query = whereOverdue(query, getCurrentTaipeiDateString());
      // **沒有到期日的帳單**（還沒發收費袋）:`outstanding` **含**、`overdue` 與
      // `dueWithin` **不含**。使用者 2026-09-07 裁定 —— 帳單存在 = 這筆錢記下來了,
      // 所以未繳清的統計要含它;但沒有到期日 = 還沒告訴家長什麼時候要繳,
      // **去催一個你從沒通知過期限的人是錯的**。
      // 機制上這不需要額外的分支:`outstanding` 沒有日期條件所以 NULL 那批通得過,
      // 另外兩個用的比較對 NULL 回 NULL,那些列撈不出來。
      if (dueWithinDays !== undefined) {
        const today = getCurrentTaipeiDateString();
        query = whereDueWithin(query, today, addDaysToDateString(today, dueWithinDays));
      }
      return query.order('issued_at', { ascending: false });
    };

    if (!derivedFilter) {
      const { data, error, count } = await build().range(
        (page - 1) * pageSize,
        page * pageSize - 1,
      );
      if (error) return c.json({ data: [], meta: { total: 0, page, pageSize } }, 200);
      const mapped = (data ?? []).map((row) =>
        toListedInvoice(row as unknown as Record<string, unknown>),
      );
      // DB 已經切好頁了 —— total 要拿 DB 的總數，不是這一頁的長度
      return c.json({ data: mapped, meta: { total: count ?? mapped.length, page, pageSize } }, 200);
    }

    // 推導路徑撈到底（原本一次撈，破千會被 max_rows 靜默截斷）；id 是同日開立時的穩定排序
    const { rows: fetched, error } = await fetchAllPages((from, to) =>
      build().order('id').range(from, to),
    );
    if (error) {
      return c.json({ data: [], meta: { total: 0, page, pageSize } }, 200);
    }

    let rows = fetched
      .filter((row) => invoiceInScope(row, campusScope))
      .map((row) => toListedInvoice(row));
    // 作廢單不在母體裡（#898）—— 它的 total − netPaid 是全額，放進來就是叫行政去催一張
    // 不存在的帳單。所以是 isOpenInvoice，不是 `!== 'paid'`
    if (unpaidOnly) rows = rows.filter((invoice) => isOpenInvoice(invoice.status));
    if (params.status) rows = rows.filter((invoice) => invoice.status === params.status);
    if (params.dueState) {
      // 在記憶體用同一支判準篩 —— 不另寫 SQL 版，免得同一條分界出現第三個實作
      const today = getCurrentTaipeiDateString();
      rows = rows.filter((invoice) => dueStateOn(invoice.dueDate, today) === params.dueState);
    }

    const paged = sliceDerivedPage(rows, page, pageSize);

    return c.json({ data: paged.rows, meta: { total: paged.total, page, pageSize } }, 200);
  },
);

// ============================================================
// GET /api/invoices/summary —— 帳本頁的彙總（#1314 P1／P2）
//
// 狀態是推導值，DB 數不出來，所以撈回來用 lib/invoice-summary 加總。**撈到底**（`fetchAllPages`）。
// 分校範圍跟列表同一支判準（#1381）。
// 必須註冊在 `/{id}` 之前，否則 `summary` 會被當成 id 驗 uuid 回 400。
// ============================================================

const BucketSchema = z.object({ count: z.number().int(), outstanding: z.number() });
const CountSchema = z.object({ count: z.number().int() });

app.openapi(
  createRoute({
    method: 'get',
    path: '/summary',
    tags: ['Invoices'],
    summary: '帳單彙總（各狀態張數與待收、逾期、本月應收／已收）',
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z
              .object({
                byStatus: z.object({
                  unpaid: BucketSchema,
                  partial: BucketSchema,
                  paid: CountSchema,
                  overrefunded: CountSchema,
                  void: CountSchema,
                }),
                overdue: BucketSchema,
                dueSoon: BucketSchema.extend({ days: z.number().int() }),
                notDue: BucketSchema,
                month: z.object({ month: z.string(), billed: z.number(), received: z.number() }),
              })
              .openapi('InvoiceSummary'),
          },
        },
      },
      500: { description: '查詢失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');

    const campusScope = getCampusScope(c);
    const select: string =
      'id, issued_at, due_date, voided_at, invoice_items(amount), payment_records(kind, amount)' +
      (campusScope === null ? '' : INVOICE_SCOPE_EMBED);
    const { rows: fetched, error } = await fetchAllPages((from, to) =>
      supabase.from('invoices').select(select).eq('org_id', orgId).order('id').range(from, to),
    );
    // 撈一半失敗就不回半套數字
    if (error) return c.json({ error: '查詢帳單彙總失敗', code: 'DB_ERROR' }, 500);
    const rows = fetched.filter((row) => invoiceInScope(row, campusScope));

    // postgrest 的 numeric 回來是字串
    const summary = summarizeInvoices(
      rows.map((row) => ({
        issuedAt: row['issued_at'] as string,
        dueDate: (row['due_date'] as string | null) ?? null,
        voided: Boolean(row['voided_at']),
        items: ((row['invoice_items'] as Array<Record<string, unknown>> | null) ?? []).map(
          (item) => ({ amount: Number(item['amount'] ?? 0) }),
        ),
        payments: ((row['payment_records'] as Array<Record<string, unknown>> | null) ?? []).map(
          (p) => ({ kind: p['kind'] as 'payment' | 'refund', amount: Number(p['amount'] ?? 0) }),
        ),
      })),
      getCurrentTaipeiDateString(),
    );

    return c.json(summary, 200);
  },
);

// ============================================================
// GET /api/invoices/:id
// ============================================================
app.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Invoices'],
    summary: '取得單一帳單（含明細與收款）',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: InvoiceSchema }) } },
      },
      404: { description: '不存在', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    const data = await findScopedInvoice(c, id, INVOICE_SELECT);

    if (!data) {
      return c.json({ error: '帳單不存在', code: 'NOT_FOUND' }, 404);
    }

    return c.json({ data: toInvoiceResponse(data as unknown as Record<string, unknown>) }, 200);
  },
);

// ============================================================
// POST /api/invoices —— 手動開帳
//
// due_date 沒給就用 org 的 invoice_due_days 算（規則 7：對齊「發袋後兩三週沒回音才催」
// 的節奏）。每張都可以再改。
// ============================================================
const CreateInvoiceSchema = z
  .object({
    studentId: DbUuidSchema,
    issuedAt: z.string().regex(DATE).optional(),
    dueDate: z.string().regex(DATE).nullable().optional(),
    note: z.string().optional(),
    items: z
      .array(
        z.object({
          type: z.enum(ITEM_TYPES),
          enrollmentId: DbUuidSchema.optional(),
          amount: z.number().int(),
          billingPeriodId: DbUuidSchema.optional(),
          periodMonth: z.string().regex(DATE).optional(),
          note: z.string().optional(),
        }),
      )
      .optional(),
  })
  .openapi('CreateInvoice');

app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Invoices'],
    summary: '開立帳單',
    request: { body: { content: { 'application/json': { schema: CreateInvoiceSchema } } } },
    responses: {
      201: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: InvoiceSchema }) } },
      },
      400: { description: '驗證錯誤', content: { 'application/json': { schema: ErrorSchema } } },
      404: {
        description: '學生或明細參照不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    // body 指名的學生與明細參照都要屬於本 org，而且要在寫入**之前**驗 ——
    // 先開帳再發現明細不對的話，回滾那一步失敗就會留下空殼（c1，#966 B4）
    const items = body.items ?? [];
    const itemEnrollmentIds = items.flatMap((item) =>
      item.enrollmentId ? [item.enrollmentId] : [],
    );
    const [student, foreignEnrollments, foreignPeriods, outOfScope] = await Promise.all([
      findInOrg(supabase, 'students', orgId, body.studentId, 'id, enrollments(classes(campus_id))'),
      missingInOrg(supabase, 'enrollments', orgId, itemEnrollmentIds),
      missingInOrg(
        supabase,
        'billing_periods',
        orgId,
        items.flatMap((item) => (item.billingPeriodId ? [item.billingPeriodId] : [])),
      ),
      hasEnrollmentOutOfScope(c, itemEnrollmentIds),
    ]);
    // 分校範圍外的學生跟不存在一樣（#1381）
    if (!student || !studentInScope(student['enrollments'], getCampusScope(c))) {
      return c.json({ error: '學生不存在', code: 'STUDENT_NOT_FOUND' }, 404);
    }
    if (foreignEnrollments.length > 0 || foreignPeriods.length > 0 || outOfScope) {
      return c.json({ error: '明細指名的報名或計費期不存在', code: 'REFERENCE_NOT_FOUND' }, 404);
    }

    // 台北時間，不是 UTC —— 見 lib/taipei-date.ts 檔頭
    const issuedAt = body.issuedAt ?? getCurrentTaipeiDateString();

    let dueDate = body.dueDate ?? null;
    if (dueDate === undefined || body.dueDate === undefined) {
      const { data: org } = await supabase
        .from('organizations')
        .select('invoice_due_days')
        .eq('id', orgId)
        .maybeSingle();
      const days = Number((org as { invoice_due_days?: number } | null)?.invoice_due_days ?? 14);
      const due = new Date(`${issuedAt}T00:00:00Z`);
      due.setUTCDate(due.getUTCDate() + days);
      dueDate = due.toISOString().slice(0, 10);
    }

    const { data: created, error } = await supabase
      .from('invoices')
      .insert({
        org_id: orgId,
        student_id: body.studentId,
        issued_at: issuedAt,
        due_date: dueDate,
        note: body.note ?? null,
        created_by: userId,
      })
      .select('id')
      .single();

    if (error || !created) {
      return c.json({ error: error?.message ?? '開帳失敗', code: 'DB_ERROR' }, 400);
    }

    const invoiceId = created['id'] as string;

    if (body.items && body.items.length > 0) {
      const { error: itemsError } = await supabase.from('invoice_items').insert(
        body.items.map((item) => ({
          invoice_id: invoiceId,
          type: item.type,
          enrollment_id: item.enrollmentId ?? null,
          amount: item.amount,
          billing_period_id: item.billingPeriodId ?? null,
          period_month: item.periodMonth ?? null,
          note: item.note ?? null,
        })),
      );

      if (itemsError) {
        // 明細寫不進去的話帳單留著只會是一張空殼，回滾掉比留著誤導好
        await inOrg(supabase.from('invoices').delete().eq('id', invoiceId), orgId);
        return c.json({ error: itemsError.message, code: 'CREATE_ITEMS_FAILED' }, 400);
      }
    }

    const { data } = await supabase
      .from('invoices')
      .select(INVOICE_SELECT)
      .eq('id', invoiceId)
      .single();

    logAudit(
      supabase,
      { orgId, userId, resourceType: 'invoice', resourceId: invoiceId, action: 'create' },
      waitUntilFrom(c),
    );

    return c.json({ data: toInvoiceResponse(data as unknown as Record<string, unknown>) }, 201);
  },
);

// ============================================================
// POST / DELETE /api/invoices/:id/items
// ============================================================
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/items',
    tags: ['Invoices'],
    summary: '新增帳單明細',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              type: z.enum(ITEM_TYPES),
              enrollmentId: DbUuidSchema.optional(),
              amount: z.number().int(),
              billingPeriodId: DbUuidSchema.optional(),
              periodMonth: z.string().regex(DATE).optional(),
              note: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: InvoiceSchema }) } },
      },
      400: { description: '驗證錯誤', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '帳單不存在', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: '帳單已作廢', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const invoice = await findScopedInvoice(c, id, 'id, voided_at');

    if (!invoice) {
      return c.json({ error: '帳單不存在', code: 'NOT_FOUND' }, 404);
    }
    if (invoice['voided_at']) return c.json(VOIDED, 409);
    // body 指名的報名與計費期要屬於本 org（#1409，同開單端點）—— 不受限的管理員不查範圍，
    // 少了這兩支就能把別 org 的 id 塞進本 org 的明細
    const enrollmentIds = body.enrollmentId ? [body.enrollmentId] : [];
    const [foreignEnrollments, foreignPeriods, outOfScope] = await Promise.all([
      missingInOrg(supabase, 'enrollments', orgId, enrollmentIds),
      missingInOrg(
        supabase,
        'billing_periods',
        orgId,
        body.billingPeriodId ? [body.billingPeriodId] : [],
      ),
      hasEnrollmentOutOfScope(c, enrollmentIds),
    ]);
    if (foreignEnrollments.length > 0 || foreignPeriods.length > 0 || outOfScope) {
      return c.json({ error: '明細指名的報名或計費期不存在', code: 'REFERENCE_NOT_FOUND' }, 404);
    }

    const { error } = await supabase.from('invoice_items').insert({
      invoice_id: id,
      type: body.type,
      enrollment_id: body.enrollmentId ?? null,
      amount: body.amount,
      billing_period_id: body.billingPeriodId ?? null,
      period_month: body.periodMonth ?? null,
      note: body.note ?? null,
    });

    if (error) {
      return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
    }

    const { data } = await supabase.from('invoices').select(INVOICE_SELECT).eq('id', id).single();

    logAudit(
      supabase,
      { orgId, userId, resourceType: 'invoice', resourceId: id, action: 'add_item' },
      waitUntilFrom(c),
    );

    return c.json({ data: toInvoiceResponse(data as unknown as Record<string, unknown>) }, 201);
  },
);

app.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}/items/{itemId}',
    tags: ['Invoices'],
    summary: '刪除帳單明細',
    request: { params: z.object({ id: DbUuidSchema, itemId: DbUuidSchema }) },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: InvoiceSchema }) } },
      },
      404: { description: '不存在', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: '帳單已作廢', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id, itemId } = c.req.valid('param');

    const invoice = await findScopedInvoice(c, id, 'id, voided_at');

    if (!invoice) {
      return c.json({ error: '帳單不存在', code: 'NOT_FOUND' }, 404);
    }
    if (invoice['voided_at']) return c.json(VOIDED, 409);

    await supabase.from('invoice_items').delete().eq('id', itemId).eq('invoice_id', id);

    const { data } = await supabase.from('invoices').select(INVOICE_SELECT).eq('id', id).single();

    logAudit(
      supabase,
      { orgId, userId, resourceType: 'invoice', resourceId: id, action: 'remove_item' },
      waitUntilFrom(c),
    );

    return c.json({ data: toInvoiceResponse(data as unknown as Record<string, unknown>) }, 200);
  },
);

// ============================================================
// POST /api/invoices/:id/payments —— 記一筆收款或退費
//
// `receipt_no` **不由 API 指定**：DB 的 BEFORE INSERT trigger 在同一個交易裡取號
// （見 migration 檔頭）。API 讀 max+1 再寫的話兩筆同時進來就會撞號。
// ============================================================
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/payments',
    tags: ['Invoices'],
    summary: '記錄收款／退費',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              kind: z.enum(PAYMENT_KINDS).optional(),
              // 金額恆正，正負由 kind 決定
              amount: z.number().int().positive(),
              method: z.enum(PAYMENT_METHODS),
              paidAt: z.string().regex(DATE).optional(),
              proofPath: z.string().optional(),
              note: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: InvoiceSchema }) } },
      },
      400: { description: '驗證錯誤', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '帳單不存在', content: { 'application/json': { schema: ErrorSchema } } },
      409: {
        description: '帳單已作廢，或退費超過這張帳單已收的淨額（REFUND_EXCEEDS_PAID）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const invoice = await findScopedInvoice(c, id, 'id, voided_at');

    if (!invoice) {
      return c.json({ error: '帳單不存在', code: 'NOT_FOUND' }, 404);
    }
    if (invoice['voided_at']) return c.json(VOIDED, 409);

    // **退費不得超過這張帳單已收的淨額**（#1034 裁決 C）。收 1,000、退 1,500 會讓淨額變 −500，
    // 帳務上沒有意義（輸入錯誤，或跨帳單的補償 —— 那該開新帳單），而家長端會把它算成新欠款。
    // ⚠️ 只擋在 API：兩筆退費同時進來時各自讀到同一個淨額，仍可能一起超過。
    // 要完全擋住得在 DB trigger 裡判（同 #898 淨額歸零的做法），另開。
    if (body.kind === 'refund') {
      const { data: rows, error: paidError } = await supabase
        .from('payment_records')
        .select('kind, amount')
        .eq('org_id', orgId)
        .eq('invoice_id', id);
      if (paidError) {
        return c.json({ error: paidError.message, code: 'DB_ERROR' }, 400);
      }
      const { net } = invoiceTotals([], (rows ?? []) as PaymentRow[]);
      if (body.amount > net) {
        const max = Math.max(0, net).toLocaleString('en-US');
        return c.json(
          {
            error: `退費超過已收：這張帳單已收淨額 ${net.toLocaleString('en-US')} 元，最多可退 ${max} 元`,
            code: 'REFUND_EXCEEDS_PAID',
          },
          409,
        );
      }
    }

    const { error } = await supabase.from('payment_records').insert({
      org_id: orgId,
      invoice_id: id,
      kind: body.kind ?? 'payment',
      amount: body.amount,
      method: body.method,
      // 台北時間，不是 UTC —— 見 lib/taipei-date.ts 檔頭
      paid_at: body.paidAt ?? getCurrentTaipeiDateString(),
      proof_path: body.proofPath ?? null,
      note: body.note ?? null,
      recorded_by: userId,
    });

    if (error) {
      return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
    }

    const { data } = await supabase.from('invoices').select(INVOICE_SELECT).eq('id', id).single();

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'payment_record',
        resourceId: id,
        action: body.kind === 'refund' ? 'refund' : 'payment',
      },
      waitUntilFrom(c),
    );

    return c.json({ data: toInvoiceResponse(data as unknown as Record<string, unknown>) }, 201);
  },
);

// ============================================================
// POST /api/invoices/:id/void —— 作廢（#898）
//
// **作廢，不刪除；淨額歸零才能作廢；不可撤銷**（使用者 2026-09-30 裁定）。
// 堂數包連著的帳單也擋（裁決 D：作廢帳單但堂數還在 = 沒收錢的堂數）。
//
// 淨額與「已作廢」在 DB trigger 另有一層（`20260930072356_invoice_void.sql`）——
// 這裡先檢查是為了回看得懂的錯誤；**競態由 trigger 擋**，所以 update 的錯誤也要接。
//
// 作廢 = 這張帳單的收費項回到未開帳（裁決 B）：
// - 學費：`billing-runs.ts` 的冪等查詢排除作廢單，不用在這裡做事
// - 餐費：冪等靠蓋章，所以要在這裡把章解掉
//
// ⚠️ 作廢與解章是兩次呼叫（supabase-js 一次呼叫一個交易，跟 billing-runs 三步式同形）。
// 死在中間 = 作廢了但餐費還蓋著 → **少收，不會重複收**，而且再按一次作廢會補做解章
// （ALREADY_VOIDED 那條路也跑一次，where 只挑這張帳單的 item，冪等）。
// ============================================================

/** 解除這張帳單餐費明細的蓋章，回解了幾筆 */
async function releaseMealStamps(
  supabase: AppEnv['Variables']['supabase'],
  orgId: string,
  items: Array<{ id: string; type: string }>,
): Promise<number> {
  const mealItemIds = items.filter((item) => item.type === 'meal').map((item) => item.id);
  if (mealItemIds.length === 0) return 0;

  const { data } = await inOrg(
    supabase
      .from('meal_records')
      .update({ invoice_item_id: null })
      .in('invoice_item_id', mealItemIds),
    orgId,
  ).select('id');

  return (data ?? []).length;
}

/** 前置檢查失敗時給行政看的話 —— 要說清楚下一步該做什麼 */
function voidBlockMessage(code: 'NET_PAID_NONZERO' | 'HAS_SESSION_PACK', netPaid: number): string {
  if (code === 'HAS_SESSION_PACK') {
    return '這張帳單的明細連到堂數包 —— 先處理堂數包才能作廢';
  }
  const amount = Math.abs(netPaid).toLocaleString('en-US');
  return netPaid > 0
    ? `已收淨額 ${amount} 元 —— 請先記一筆退款把淨額歸零才能作廢`
    : `退款比收款多 ${amount} 元 —— 淨額要歸零才能作廢`;
}

app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/void',
    tags: ['Invoices'],
    summary: '作廢帳單（不可撤銷）',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: {
        content: {
          'application/json': {
            schema: z.object({ reason: z.string().trim().min(1).max(500) }),
          },
        },
      },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: InvoiceSchema }) } },
      },
      400: { description: '驗證錯誤', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '帳單不存在', content: { 'application/json': { schema: ErrorSchema } } },
      409: {
        description: '已作廢／淨額不為 0／連到堂數包',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '檢查失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');

    const row = await findScopedInvoice(c, id, INVOICE_SELECT);

    if (!row) {
      return c.json({ error: '帳單不存在', code: 'NOT_FOUND' }, 404);
    }

    const invoice = toInvoiceResponse(row as unknown as Record<string, unknown>);

    if (invoice.voidedAt !== null) {
      await releaseMealStamps(supabase, orgId, invoice.items);
      return c.json({ error: '這張帳單已經作廢過了', code: 'ALREADY_VOIDED' }, 409);
    }

    // 堂數包：查不到答案要當成「擋」（fail-closed，跟 enrollment-session-pack-guard 同形狀）
    let hasSessionPack = false;
    if (invoice.items.length > 0) {
      const { count, error } = await supabase
        .from('session_packs')
        .select('id', { count: 'exact', head: true })
        .in(
          'invoice_item_id',
          invoice.items.map((item) => item.id),
        );
      if (error) {
        return c.json({ error: '無法確認堂數包，請稍後再試', code: 'CHECK_FAILED' }, 500);
      }
      hasSessionPack = (count ?? 0) > 0;
    }

    const { net } = invoiceTotals(invoice.items, invoice.payments);
    const blocked = voidBlockReason({ voided: false, netPaid: net, hasSessionPack });
    if (blocked === 'NET_PAID_NONZERO' || blocked === 'HAS_SESSION_PACK') {
      return c.json({ error: voidBlockMessage(blocked, net), code: blocked }, 409);
    }

    // 條件式：只在 voided_at 仍為空時生效 —— 檢查之後被別人先作廢了，這裡回 0 列
    const { data: updated, error: updateError } = await supabase
      .from('invoices')
      .update({ voided_at: new Date().toISOString(), voided_by: userId, void_reason: reason })
      .eq('id', id)
      .eq('org_id', orgId)
      .is('voided_at', null)
      .select('id');

    if (updateError) {
      // 檢查之後插進一筆收款：trigger 以淨額 ≠ 0 拒絕。這是業務衝突不是系統錯誤
      return c.json(
        {
          error: '帳單在作廢的同時有變動（例如剛記了一筆收款），請重新整理再試',
          code: 'VOID_REJECTED',
        },
        409,
      );
    }
    if (!updated || updated.length === 0) {
      return c.json({ error: '這張帳單已經作廢過了', code: 'ALREADY_VOIDED' }, 409);
    }

    const mealRecordsReleased = await releaseMealStamps(supabase, orgId, invoice.items);

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'invoice',
        resourceId: id,
        action: 'invoice.void',
        details: { reason, total: invoice.total, mealRecordsReleased },
      },
      waitUntilFrom(c),
    );

    const { data } = await supabase.from('invoices').select(INVOICE_SELECT).eq('id', id).single();

    return c.json({ data: toInvoiceResponse(data as unknown as Record<string, unknown>) }, 200);
  },
);

// ============================================================
// 催繳：記錄與列表
//
// 規則 7：催繳是**業務資料**不塞 audit_logs —— 行政要看得到「這張催過幾次、怎麼催的」。
// ============================================================
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/reminders',
    tags: ['Invoices'],
    summary: '記錄一次催繳',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              method: z.enum(REMINDER_METHODS),
              note: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      404: { description: '帳單不存在', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: '帳單已作廢', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const invoice = await findScopedInvoice(c, id, 'id, voided_at');

    if (!invoice) {
      return c.json({ error: '帳單不存在', code: 'NOT_FOUND' }, 404);
    }
    if (invoice['voided_at']) return c.json(VOIDED, 409);

    await supabase.from('payment_reminders').insert({
      invoice_id: id,
      method: body.method,
      note: body.note ?? null,
      created_by: userId,
    });

    // #901：同檔另外四支寫入都有稽核，只有這一支漏了。
    // `details` 記管道（催繳爭議時要答得出「用哪個方式、什麼時候」）。
    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'invoice',
        resourceId: id,
        action: 'invoice.remind',
        details: { method: body.method },
      },
      waitUntilFrom(c),
    );

    return c.json({ success: true }, 201);
  },
);

app.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/reminders',
    tags: ['Invoices'],
    summary: '催繳記錄列表',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(
                z.object({
                  id: DbUuidSchema,
                  method: z.enum(REMINDER_METHODS),
                  note: z.string().nullable(),
                  createdBy: z.string().nullable(),
                  createdAt: z.string(),
                }),
              ),
            }),
          },
        },
      },
      404: { description: '帳單不存在', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    const invoice = await findScopedInvoice(c, id, 'id');

    if (!invoice) {
      return c.json({ error: '帳單不存在', code: 'NOT_FOUND' }, 404);
    }

    const { data } = await supabase
      .from('payment_reminders')
      .select('id, method, note, created_by, created_at')
      .eq('invoice_id', id)
      .order('created_at', { ascending: false });

    return c.json(
      {
        data: (data ?? []).map((row) => ({
          id: row['id'] as string,
          method: row['method'] as (typeof REMINDER_METHODS)[number],
          note: (row['note'] as string | null) ?? null,
          createdBy: (row['created_by'] as string | null) ?? null,
          createdAt: row['created_at'] as string,
        })),
      },
      200,
    );
  },
);

export default app;
