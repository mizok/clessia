import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv } from '../index';
import { logAudit, logAuditMany } from '../utils/audit';
import { getAuth } from '../lib/get-auth';
import { recordPayment, type RecordPaymentOutcome } from '../lib/record-payment';
import { notifyEnrollmentCompleted } from '../lib/notify-events';
import { INVOICE_SELECT, toInvoiceResponse } from '../lib/invoice-query';
import { sliceDerivedPage } from '../lib/derived-page';
import { waitUntilFrom } from '../lib/wait-until';
import { DbUuidSchema } from '../lib/validation';
import { attachParentContacts, type ParentRelationRow } from '../lib/student-parents';
import { paymentInfoEntries } from '../lib/payment-info';
import { isPlaceholderEmail } from './parents';
import { findInOrg, inOrg, missingInOrg } from '../lib/org-scope';
import { campusFilterIds, getCampusScope } from '../lib/campus-scope';
import {
  enrollmentsInScope,
  INVOICE_SCOPE_EMBED,
  invoiceInScope,
  invoiceTouchesScope,
  studentInScope,
} from '../lib/invoice-campus-scope';
import { addDaysToDateString, getCurrentTaipeiDateString } from '../lib/taipei-date';
import { dueStateOn, whereDueWithin, whereOverdue } from '../lib/invoice-overdue';
import { summarizeInvoices } from '../lib/invoice-summary';
import { fetchAllPages } from '../lib/fetch-all-pages';
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
    /** INV-YYMM-NNN（#1459）。null 只會是回填前的舊單 */
    invoiceNo: z.string().nullable(),
    studentId: DbUuidSchema,
    studentName: z.string().nullable(),
    studentGrade: z.string().nullable(),
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
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Invoice');

/**
 * 單張帳單才有的欄位（#1625 快速聯絡家長）。**列表不帶** —— 一次幾百張，不該順便帶出幾百位家長的個資。
 * 家長只在帳單過了 `findScopedInvoice`（org＋分校範圍）之後才讀，授權跟著帳單走。
 */
const InvoiceDetailSchema = InvoiceSchema.extend({
  parents: z.array(
    z.object({
      id: DbUuidSchema,
      name: z.string(),
      relation: z.string().nullable(),
      phone: z.string().nullable(),
      /** 只留電話的家長，`ba_user.email` 是系統產的 placeholder —— 回 null（沒有留 email） */
      email: z.string().nullable(),
      isPrimary: z.boolean(),
    }),
  ),
  /** 帳單明細所屬分校的匯款資料（分校覆寫優先、以內容去重）；沒有班的單退回機構預設 */
  paymentInfo: z.array(z.object({ campusName: z.string().nullable(), text: z.string() })),
}).openapi('InvoiceDetail');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string().optional() })
  .openapi('InvoiceError');

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 指定分校（#1314 DB-campus）。**跟受限範圍取交集**（`campusFilterIds`）再餵 `invoiceInScope` ——
 * 不受限的人選 A 校，看到的就是 A 校受限管理員看到的那批，不另開一份判準。
 * 代價：跨校帳單（明細的班分屬兩校）在選任一校時都不出現，各校加總 < 全部分校（計畫席 10-10 裁）。
 */
const CampusIdQuerySchema = DbUuidSchema.optional().openapi({
  description: '只看這間分校的帳單（與受限範圍取交集；不帶＝範圍內全部）',
});

const app = new OpenAPIHono<AppEnv>();

// ponytail: 帳單列表／彙總撈到底（`lib/fetch-all-pages`）是 O(全部帳單) 每次呼叫；量大時升級成 DB 側 view／RPC

/** 'YYYY-MM' → 下個月 1 號 'YYYY-MM-01' */
function nextMonthStart(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`;
}

/**
 * 以 id 取一張帳單，**org 與分校範圍都套**（#1381）。範圍外跟不存在一樣回 null → 路由回 404
 * （同 `findInOrg` 慣例：以 id 指名的單筆資源，不透露存在；計畫席 10-08 gate 裁定）。
 * 查詢失敗丟（500），不是 404。
 */
async function findScopedInvoice(
  c: Context<AppEnv>,
  id: string,
  columns: string,
): Promise<Record<string, unknown> | null> {
  const select: string = columns + INVOICE_SCOPE_EMBED;
  const { data, error } = await c
    .get('supabase')
    .from('invoices')
    .select(select)
    .eq('id', id)
    .eq('org_id', c.get('orgId'))
    .maybeSingle();
  // 讀取失敗丟（500），不折成 null —— 否則畫面跟「帳單不存在」一模一樣（#1630）
  if (error) throw new Error(`findScopedInvoice failed: ${error.message}`);
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
        search: z.string().optional().openapi({
          description: '學生姓名、任一位家長姓名、或帳單編號（部分比對）—— 家長來繳錢時找帳單',
        }),
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
          .openapi({
            description: 'YYYY-MM = 只看這個月開立的（匯出用，#1314 P4；同彙總「本月」的定義）',
          }),
        campusId: CampusIdQuerySchema,
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
      500: {
        description: '查詢失敗（含搜尋子查詢）',
        content: { 'application/json': { schema: ErrorSchema } },
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
    // 分校範圍（#1381）在記憶體判（`lib/invoice-campus-scope.ts`），所以受限者也走推導路徑。
    // 指定分校＝跟受限範圍取交集，餵同一個判準（#1314 DB-campus）
    const campusScope = campusFilterIds(getCampusScope(c), params.campusId);
    // 全都是推導條件 —— 帶了任一個就不能讓 DB 分頁，否則被篩掉的那些會在頁與頁之間留洞
    const derivedFilter = unpaidOnly || Boolean(params.status) || campusScope !== null;

    const select: string = INVOICE_SELECT + (campusScope === null ? '' : INVOICE_SCOPE_EMBED);
    // 搜尋先解析成學生 id（姓名或家長姓名），再當條件下 —— 兩條分頁路徑都吃得到。
    // 沒命中 = 空集合（`in.()` 零筆），不是「不篩」
    const search = params.search?.trim().replace(/[,()*%"\\]/g, '');
    let searchStudentIds: string[] | null = null;
    if (params.search !== undefined) {
      if (!search) return c.json({ data: [], meta: { total: 0, page, pageSize } }, 200);
      const [byName, byParent] = await Promise.all([
        supabase.from('students').select('id').eq('org_id', orgId).ilike('name', `%${search}%`),
        supabase
          .from('parent_student_relations')
          .select('student_id, parents!inner(name, org_id)')
          .eq('parents.org_id', orgId)
          .ilike('parents.name', `%${search}%`),
      ]);
      // 查不到 ≠ 沒這個人：回空清單的話行政會以為「沒有他的帳單」（reviewer 二讀 #1460）
      const searchError = byName.error ?? byParent.error;
      if (searchError) {
        return c.json(
          { error: '搜尋帳單失敗', code: 'SEARCH_FAILED', message: searchError.message },
          500,
        );
      }
      searchStudentIds = [
        ...new Set([
          ...((byName.data ?? []) as Array<{ id: string }>).map((row) => row.id),
          ...((byParent.data ?? []) as Array<{ student_id: string }>).map((row) => row.student_id),
        ]),
      ];
    }

    const build = () => {
      let query = supabase
        .from('invoices')
        .select(select, derivedFilter ? undefined : { count: 'exact' })
        .eq('org_id', orgId);
      if (params.studentId) query = query.eq('student_id', params.studentId);
      // 學生（姓名／家長）或帳單編號（#1459）其一命中。空的 `in.()` 合法、只是那一半不命中
      if (searchStudentIds) {
        query = query.or(
          `student_id.in.(${searchStudentIds.join(',')}),invoice_no.ilike.%${search}%`,
        );
      }
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
      // 查不到 ≠ 沒有帳單：回空清單會讓繳費頁顯示「沒有帳單」（計畫席 10-10 裁，同 SEARCH_FAILED）
      if (error) {
        return c.json({ error: '讀取帳單失敗', code: 'LIST_FAILED', message: error.message }, 500);
      }
      const mapped = (data ?? []).map((row) =>
        toInvoiceResponse(row as unknown as Record<string, unknown>),
      );
      // DB 已經切好頁了 —— total 要拿 DB 的總數，不是這一頁的長度
      return c.json({ data: mapped, meta: { total: count ?? mapped.length, page, pageSize } }, 200);
    }

    // 推導路徑撈到底（原本一次撈，破千會被 max_rows 靜默截斷）；id 是同日開立時的穩定排序
    const { rows: fetched, error } = await fetchAllPages((from, to) =>
      build().order('id').range(from, to),
    );
    if (error) {
      const message = (error as { message?: string }).message ?? String(error);
      return c.json({ error: '讀取帳單失敗', code: 'LIST_FAILED', message }, 500);
    }

    let rows = fetched
      .filter((row) => invoiceInScope(row, campusScope))
      .map((row) => toInvoiceResponse(row));
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
    request: {
      // 學生檔案帳單章（#1314 P3）：只算這位學生的帳單；範圍外的學生回全零（同列表帶 studentId）
      query: z.object({ studentId: DbUuidSchema.optional(), campusId: CampusIdQuerySchema }),
    },
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
                  paid: CountSchema.extend({ received: z.number() }),
                  overrefunded: CountSchema,
                  void: CountSchema,
                }),
                overdue: BucketSchema,
                dueSoon: BucketSchema.extend({ days: z.number().int() }),
                notDue: BucketSchema,
                outstanding: z.number(),
                month: z.object({ month: z.string(), billed: z.number(), received: z.number() }),
                crossCampusOverdue: CountSchema.openapi({
                  description:
                    '被 campusId 篩選排除的跨校逾期帳單張數（儀表板「另有 N 張跨校帳單」）。不帶 campusId 恆 0',
                }),
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

    const { studentId, campusId } = c.req.valid('query');
    const baseScope = getCampusScope(c);
    const campusScope = campusFilterIds(baseScope, campusId);
    const select: string =
      'id, issued_at, due_date, voided_at, invoice_items(amount), payment_records(kind, amount)' +
      (campusScope === null ? '' : INVOICE_SCOPE_EMBED);
    const { rows: fetched, error } = await fetchAllPages((from, to) => {
      let query = supabase.from('invoices').select(select).eq('org_id', orgId);
      if (studentId) query = query.eq('student_id', studentId);
      return query.order('id').range(from, to);
    });
    // 撈一半失敗就不回半套數字
    if (error) return c.json({ error: '查詢帳單彙總失敗', code: 'DB_ERROR' }, 500);
    const rows = fetched.filter((row) => invoiceInScope(row, campusScope));
    // 跨校帳單 N（#1314 儀表板）：授權範圍內看得到、被篩選排除、但有班的明細也落在篩選範圍內。
    // 純餐費跨校單不會被排除（兩校都看得到），所以不在這裡。逾期判準借 summarizeInvoices
    const crossCampus =
      campusScope === null
        ? []
        : fetched.filter(
            (row) =>
              invoiceInScope(row, baseScope) &&
              !invoiceInScope(row, campusScope) &&
              invoiceTouchesScope(row, campusScope),
          );

    const today = getCurrentTaipeiDateString();
    const summary = summarizeInvoices(rows.map(toSummaryInvoice), today);
    const crossCampusOverdue = {
      count: summarizeInvoices(crossCampus.map(toSummaryInvoice), today).overdue.count,
    };

    return c.json({ ...summary, crossCampusOverdue }, 200);
  },
);

// postgrest 的 numeric 回來是字串
function toSummaryInvoice(row: Record<string, unknown>) {
  return {
    issuedAt: row['issued_at'] as string,
    dueDate: (row['due_date'] as string | null) ?? null,
    voided: Boolean(row['voided_at']),
    items: ((row['invoice_items'] as Array<Record<string, unknown>> | null) ?? []).map((item) => ({
      amount: Number(item['amount'] ?? 0),
    })),
    payments: ((row['payment_records'] as Array<Record<string, unknown>> | null) ?? []).map(
      (p) => ({ kind: p['kind'] as 'payment' | 'refund', amount: Number(p['amount'] ?? 0) }),
    ),
  };
}

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
        content: { 'application/json': { schema: z.object({ data: InvoiceDetailSchema }) } },
      },
      404: { description: '不存在', content: { 'application/json': { schema: ErrorSchema } } },
      500: {
        description: '讀取家長聯絡方式或匯款資料失敗',
        content: { 'application/json': { schema: ErrorSchema } },
      },
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

    // ⚠️ 以下兩段都在範圍判斷之後 —— 帳單看不到，就什麼家長都不讀（#1625 保留類）
    const campusIds = [
      ...new Set(
        ((data['scope_items'] as Array<Record<string, unknown>> | null) ?? [])
          .map(
            (item) =>
              (
                (item['enrollments'] as Record<string, unknown> | null)?.['classes'] as
                  Record<string, unknown> | null | undefined
              )?.['campus_id'] as string | null | undefined,
          )
          .filter((campusId): campusId is string => !!campusId),
      ),
    ];
    const [relations, campuses, org] = await Promise.all([
      supabase
        .from('parent_student_relations')
        .select('id, is_primary, relation, parents(id, name, user_id)')
        .eq('student_id', data['student_id'] as string),
      campusIds.length === 0
        ? Promise.resolve({ data: [] })
        : supabase
            .from('campuses')
            .select('name, payment_info')
            .eq('org_id', orgId)
            .in('id', campusIds),
      supabase.from('organizations').select('payment_info').eq('id', orgId).maybeSingle(),
    ]);
    // 任一支讀不到就整張失敗（#1625 計畫席擋點）—— 吞掉的話回應是「沒有家長／沒有留電話」，
    // 跟真的沒有一模一樣，行政會以為聯絡不到而放棄
    const contacts = relations.error
      ? null
      : await attachParentContacts(
          supabase,
          (relations.data ?? []) as unknown as ParentRelationRow[],
        );
    const readError =
      relations.error ??
      contacts?.error ??
      ('error' in campuses ? campuses.error : null) ??
      org.error;
    if (readError || !contacts) {
      return c.json({ error: '讀取家長聯絡方式失敗', code: 'SERVER_ERROR' }, 500);
    }
    // 預設網域跟 `generatePlaceholderEmail` 同一個，產生與判斷才對得上
    const placeholderDomain = c.env?.PLACEHOLDER_EMAIL_DOMAIN ?? 'phone.internal';
    const parents = contacts.parents
      .map((p) => ({
        id: p.id,
        name: p.name,
        relation: p.relation,
        phone: p.phone,
        email: isPlaceholderEmail(p.email, placeholderDomain) ? null : p.email,
        isPrimary: p.isPrimary,
      }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    const paymentInfo = paymentInfoEntries(
      ((campuses.data ?? []) as Array<{ name: string; payment_info: string | null }>).map((r) => ({
        name: r.name,
        paymentInfo: r.payment_info,
      })),
      (org.data as { payment_info?: string | null } | null)?.payment_info ?? null,
    );

    return c.json(
      {
        data: {
          ...toInvoiceResponse(data as unknown as Record<string, unknown>),
          parents,
          paymentInfo,
        },
      },
      200,
    );
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

const ChangedRowSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  studentName: z.string(),
  className: z.string(),
});

// ============================================================
// POST /api/invoices/:id/payments —— 記一筆收款或退費
//
// 收款同一個交易裡把這張帳單上的 `pending_payment` 報名轉正式、繳清時完成申請（#1778，
// 交易本體在 `lib/record-payment.ts`）。退費在鎖住帳單之後才數淨額，兩筆退費同時進來不會一起超過。
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
        description:
          '成功；收款時一併帶出這筆轉為正式的報名、繳清而完成的申請（#1778，退費兩個都是空陣列）',
        content: {
          'application/json': {
            schema: z.object({
              data: InvoiceSchema,
              activatedEnrollments: z.array(ChangedRowSchema),
              completedRequests: z.array(ChangedRowSchema),
            }),
          },
        },
      },
      400: { description: '驗證錯誤', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '帳單不存在', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: '寫入失敗', content: { 'application/json': { schema: ErrorSchema } } },
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

    // 分校範圍在這裡擋（範圍外 = 404）；作廢先擋一次省一趟交易，交易裡鎖住帳單再判一次（併發作廢）
    const invoice = await findScopedInvoice(c, id, 'id, voided_at');
    if (!invoice) {
      return c.json({ error: '帳單不存在', code: 'NOT_FOUND' }, 404);
    }
    if (invoice['voided_at']) return c.json(VOIDED, 409);
    // 收款與轉正式要全有或全無，不退回 supabase-js 逐句寫（pg-pool-writes rule 6）
    const pool = getAuth(c).pool;
    if (!pool) return c.json({ error: '記錄失敗', code: 'DB_POOL_UNAVAILABLE' }, 500);

    const kind = body.kind ?? 'payment';
    const today = getCurrentTaipeiDateString();
    let r: RecordPaymentOutcome;
    try {
      r = await recordPayment(pool, {
        orgId,
        userId,
        invoiceId: id,
        kind,
        amount: body.amount,
        method: body.method,
        // 台北時間，不是 UTC —— 見 lib/taipei-date.ts 檔頭
        paidAt: body.paidAt ?? today,
        proofPath: body.proofPath ?? null,
        note: body.note ?? null,
        today,
      });
    } catch (err) {
      console.error('[invoices] record payment failed', err);
      return c.json({ error: '記錄失敗', code: 'SERVER_ERROR' }, 500);
    }

    switch (r.status) {
      case 'not-found':
        return c.json({ error: '帳單不存在', code: 'NOT_FOUND' }, 404);
      case 'voided':
        return c.json(VOIDED, 409);
      // **退費不得超過這張帳單已收的淨額**（#1034 裁決 C）。收 1,000、退 1,500 會讓淨額變 −500，
      // 帳務上沒有意義（輸入錯誤，或跨帳單的補償 —— 那該開新帳單），而家長端會把它算成新欠款。
      case 'refund-exceeds-paid': {
        const max = Math.max(0, r.net).toLocaleString('en-US');
        return c.json(
          {
            error: `退費超過已收：這張帳單已收淨額 ${r.net.toLocaleString('en-US')} 元，最多可退 ${max} 元`,
            code: 'REFUND_EXCEEDS_PAID',
          },
          409,
        );
      }
    }

    const { data } = await supabase.from('invoices').select(INVOICE_SELECT).eq('id', id).single();

    const wu = waitUntilFrom(c);
    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'payment_record',
        resourceId: id,
        action: kind === 'refund' ? 'refund' : 'payment',
      },
      wu,
    );
    // 「這個學生什麼時候轉正式」查得到：報名、申請各自一列
    logAuditMany(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'enrollment',
        action: 'update',
        details: {
          before: { status: 'pending_payment' },
          after: { status: 'active' },
          via: 'payment',
          paymentId: r.paymentId,
        },
      },
      r.activated.map((e) => ({
        resourceId: e.id,
        resourceName: `${e.studentName}（${e.className}）`,
      })),
      wu,
    );
    logAuditMany(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'enrollment_request',
        action: 'complete',
        details: { via: 'payment', paymentId: r.paymentId, invoice_id: id },
      },
      r.completed.map((q) => ({
        resourceId: q.id,
        resourceName: `${q.studentName}（${q.className}）`,
      })),
      wu,
    );
    // 交易外發（pg-pool-writes rule 7）；失敗只記 log，收款不回滾
    for (const q of r.completed) {
      const job = notifyEnrollmentCompleted(supabase, {
        orgId,
        requestId: q.id,
        studentId: q.studentId,
        studentName: q.studentName,
        className: q.className,
      });
      if (wu) wu(job);
      else await job;
    }

    return c.json(
      {
        data: toInvoiceResponse(data as unknown as Record<string, unknown>),
        activatedEnrollments: [...r.activated],
        completedRequests: [...r.completed],
      },
      201,
    );
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

// 催繳紀錄（`payment_reminders` 的三支端點、列表的 lastRemindedAt）在 #1625 拿掉：使用者裁定
// 「只記錄有沒有用某種軟體催過」沒有意義，改成帳單詳情直接聯絡家長。表與既有資料保留（加法優先）。

export default app;
