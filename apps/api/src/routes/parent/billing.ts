import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { isChildAllowed } from '../../lib/child-scope';
import { INVOICE_SELECT, toInvoiceResponse, type InvoiceResponse } from '../../lib/invoice-query';
import { isOpenInvoice } from '../../lib/invoice-status';
import { getCurrentTaipeiDateString } from '../../lib/taipei-date';
import { DbUuidSchema } from '../../lib/validation';
import { paymentInfoEntries } from '../../lib/payment-info';
import type { ChildDb } from '../../lib/child-db';

/**
 * 家長端的帳單列表。複用 `routes/invoices.ts`（admin）的 select 與 mapper
 * （`lib/invoice-query.ts`），換掉查詢用的 client（`supabase` → `childDb`），
 * 再過一層 **allowlist**（不是 denylist）映射砍掉內部備註與經手人 ——
 * allowlist 讓將來新增的欄位預設不外流，denylist 會預設外流。
 * 見 kb/wiki/architecture/parent-read-endpoints.md。
 */

const ParentInvoiceItemSchema = z
  .object({
    id: DbUuidSchema,
    type: z.enum(['tuition', 'meal', 'session_pack', 'adjustment']),
    amount: z.number(),
    periodMonth: z.string().nullable(),
    /** 班名（#1314 PP2）：掛在報名的明細才有；餐費等沒報名的 → null */
    className: z.string().nullable(),
  })
  .openapi('ParentInvoiceItem');

const ParentPaymentRecordSchema = z
  .object({
    id: DbUuidSchema,
    kind: z.enum(['payment', 'refund']),
    amount: z.number(),
    method: z.enum(['cash', 'transfer']),
    paidAt: z.string(),
    receiptNo: z.number().nullable(),
  })
  .openapi('ParentPaymentRecord');

const ParentInvoiceSchema = z
  .object({
    id: DbUuidSchema,
    /** INV-YYMM-NNN（#1459）；回填前的舊單 → null */
    invoiceNo: z.string().nullable(),
    issuedAt: z.string(),
    dueDate: z.string().nullable(),
    status: z.enum(['unpaid', 'partial', 'paid', 'void', 'overrefunded']),
    total: z.number(),
    netPaid: z.number(),
    /** #898。作廢理由與經手人不外流（跟 note 一樣是行政內部），只給時間 */
    voidedAt: z.string().nullable(),
    items: z.array(ParentInvoiceItemSchema),
    payments: z.array(ParentPaymentRecordSchema),
    createdAt: z.string(),
  })
  .openapi('ParentInvoice');

const ListResponseSchema = z
  .object({
    data: z.array(ParentInvoiceSchema),
    meta: z.object({
      total: z.number().int().min(0),
      /** 全量張數（#2446）：待繳＝unpaid/partial、已繳清＝paid/overrefunded、作廢 —— 不受分頁截斷 */
      counts: z.object({
        pending: z.number().int().min(0),
        paid: z.number().int().min(0),
        voided: z.number().int().min(0),
      }),
      /** 待繳裡最早、且已過的期限（#2446「最久的逾期」）；沒有 → null */
      overdueSince: z.string().nullable(),
      /** 待繳裡最早、且還沒過的期限（今天到期算這邊）；沒有 → null */
      nextDue: z.string().nullable(),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1),
      /** 這個孩子全部未繳清帳單的 (total − netPaid) 加總，不分頁截斷 */
      totalDue: z.number(),
      /**
       * 補習班帳戶資訊（#1073）：這個孩子**在籍**分校的生效值（分校覆寫 → 機構預設），以內容去重。
       * 多筆時標分校名。全都沒設定 → `[]`。
       */
      paymentInfo: z.array(z.object({ campusName: z.string().nullable(), text: z.string() })),
      /**
       * 本學期已繳（#1314 PP1）。本學期＝涵蓋台北今天的收費期間（重疊取開始日最晚）；沒有 → null。
       * `paid`＝**明細掛在這一期**的非作廢帳單之淨收（收款－退款）—— 不是收款日落在期內：
       * 開學前先繳的要算、期內補繳上一期欠款的不算。
       */
      term: z
        .object({
          name: z.string(),
          startDate: z.string(),
          endDate: z.string(),
          paid: z.number(),
        })
        .nullable(),
    }),
  })
  .openapi('ParentInvoiceListResponse');

const ErrorSchema = z.object({ error: z.string(), code: z.string() }).openapi('ParentInvoiceError');

/**
 * allowlist：明確列出保留的欄位。**`note`（帳單/明細/收款的內部備註，例如
 * 「家長來電抱怨」「特殊減免原因」）與 `recordedBy`（內部經手人）一律不回**，
 * `proofPath`（收款憑證檔案路徑）這輪也不回 —— 家長端 v1 沒有檔案下載的 UI，
 * 回一個打不開的路徑沒有意義，要開放是另一個牽涉檔案存取授權的決定。
 */
function toParentInvoice(invoice: InvoiceResponse, classNames: ReadonlyMap<string, string>) {
  return {
    id: invoice.id,
    invoiceNo: invoice.invoiceNo,
    issuedAt: invoice.issuedAt,
    dueDate: invoice.dueDate,
    status: invoice.status,
    total: invoice.total,
    netPaid: invoice.netPaid,
    voidedAt: invoice.voidedAt,
    items: invoice.items.map((item) => ({
      id: item.id,
      type: item.type,
      amount: item.amount,
      periodMonth: item.periodMonth,
      className: (item.enrollmentId && classNames.get(item.enrollmentId)) || null,
    })),
    payments: invoice.payments.map((payment) => ({
      id: payment.id,
      kind: payment.kind,
      amount: payment.amount,
      method: payment.method,
      paidAt: payment.paidAt,
      receiptNo: payment.receiptNo,
    })),
    createdAt: invoice.createdAt,
  };
}

/** 在籍＝佔名額的那兩種狀態（跟 `enrollments/validation.ts` 的額滿判斷同一組） */
const ENROLLED_STATUSES = new Set(['active', 'pending_payment']);

/** 孩子在籍的班 → 分校 → 生效的帳戶資訊（#1073）。讀法全走 childDb，不碰原始 supabase */
async function readPaymentInfo(childDb: ChildDb, childId: string) {
  const enrollments = await childDb
    .from('enrollments', 'student_id')
    .pluck('class_id, status', 'class_id', childId);
  const classIds = [
    ...new Set(
      enrollments.rows
        .filter((r) => ENROLLED_STATUSES.has(r['status'] as string))
        .map((r) => r['class_id'] as string),
    ),
  ];

  const classes =
    classIds.length === 0
      ? { data: [], error: null }
      : await childDb.orgRef('classes').select('id, campus_id').in('id', classIds);
  const campusIds = [
    ...new Set(
      ((classes.data ?? []) as unknown as Array<{ campus_id: string | null }>)
        .map((r) => r.campus_id)
        .filter((id): id is string => !!id),
    ),
  ];

  const [campuses, org] = await Promise.all([
    campusIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : childDb.orgRef('campuses').select('id, name, payment_info').in('id', campusIds),
    childDb.orgPaymentInfo(),
  ]);

  const error = enrollments.error ?? classes.error ?? campuses.error ?? org.error;
  const campusRows = (campuses.data ?? []) as unknown as Array<{
    name: string;
    payment_info: string | null;
  }>;
  return {
    error,
    entries: paymentInfoEntries(
      campusRows.map((r) => ({ name: r.name, paymentInfo: r.payment_info })),
      org.paymentInfo,
    ),
  };
}

function groupOf(status: InvoiceResponse['status']): 'pending' | 'paid' | 'voided' {
  if (status === 'void') return 'voided';
  return isOpenInvoice(status) ? 'pending' : 'paid';
}

const GROUP_ORDER = { pending: 0, paid: 1, voided: 2 } as const;

/**
 * 家長端的列順序（#2446，同 A6 `p-payments.html`）：待繳依期限升冪（沒期限墊底）→
 * 已繳清依開立日新到舊 → 作廢依開立日新到舊。前端分章靠這個順序，所以第 1 頁就是最該先繳的。
 */
function sortForParent(invoices: InvoiceResponse[]): InvoiceResponse[] {
  return [...invoices].sort((a, b) => {
    const ga = groupOf(a.status);
    const gb = groupOf(b.status);
    if (ga !== gb) return GROUP_ORDER[ga] - GROUP_ORDER[gb];
    if (ga === 'pending') {
      const da = a.dueDate ?? '9999';
      const db = b.dueDate ?? '9999';
      if (da !== db) return da < db ? -1 : 1;
    }
    return a.issuedAt < b.issuedAt ? 1 : a.issuedAt > b.issuedAt ? -1 : 0;
  });
}

const app = new OpenAPIHono<AppEnv>();

// GET /api/me/billing
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Me'],
    summary: '這個孩子的帳單列表',
    request: {
      query: z.object({
        childId: DbUuidSchema,
        page: z.coerce.number().int().min(1).default(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).default(20).optional(),
      }),
    },
    responses: {
      200: { description: '成功', content: { 'application/json': { schema: ListResponseSchema } } },
      403: {
        description: '不是家長身分或這個孩子不在範圍內',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (!(c.get('roles') ?? []).includes('parent')) {
      return c.json({ error: '不是家長身分', code: 'NOT_PARENT' }, 403);
    }

    const { childId, page = 1, pageSize = 20 } = c.req.valid('query');

    if (!isChildAllowed(c.get('studentScope'), childId)) {
      return c.json({ error: '沒有這個孩子的權限', code: 'CHILD_OUT_OF_SCOPE' }, 403);
    }

    const childDb = c.get('childDb');
    const from = (page - 1) * pageSize;

    // 撈這個孩子的**全部**帳單，排序與分頁在記憶體做（#2446）：`totalDue`、張數、期限都要全量，
    // 分頁截斷不能拿來算；而排序是「待繳依期限」，DB 單一 order 排不出這種分組順序。
    // ponytail: 一個孩子幾十到幾百張；真的上千張再改成 DB 端分組排序。
    const today = getCurrentTaipeiDateString();
    const [allResult, paymentInfo, termResult, enrollmentNames] = await Promise.all([
      childDb.from('invoices', 'student_id').select(INVOICE_SELECT).eq('student_id', childId),
      readPaymentInfo(childDb, childId),
      childDb
        .orgRef('billing_periods')
        .select('id, name, start_date, end_date')
        .lte('start_date', today)
        .gte('end_date', today)
        .order('start_date', { ascending: false })
        .limit(1),
      // 明細 → 報名 → 班名（PP2）。含退班的報名：舊帳單的班名不該因為退班就消失
      childDb.from('enrollments', 'student_id').pluck('id, classes(name)', 'id', childId),
    ]);

    if (allResult.error || paymentInfo.error || termResult.error || enrollmentNames.error) {
      return c.json({ error: '讀取帳單失敗', code: 'FETCH_BILLING_FAILED' }, 500);
    }

    const allRows = (allResult.data ?? []) as unknown as Record<string, unknown>[];

    const classNames = new Map<string, string>();
    for (const row of enrollmentNames.rows) {
      const name = (row['classes'] as { name?: string } | null)?.name;
      if (name) classNames.set(row['id'] as string, name);
    }
    const allInvoices = sortForParent(allRows.map((row) => toInvoiceResponse(row)));
    const mapped = allInvoices
      .slice(from, from + pageSize)
      .map((invoice) => toParentInvoice(invoice, classNames));
    const pendingDues = allInvoices
      .filter((invoice) => isOpenInvoice(invoice.status) && invoice.dueDate !== null)
      .map((invoice) => invoice.dueDate!); // 已依期限升冪
    const counts = { pending: 0, paid: 0, voided: 0 };
    for (const invoice of allInvoices) counts[groupOf(invoice.status)]++;
    const totalDue = allInvoices
      // isOpenInvoice 而不是 `!== 'paid'` —— 作廢單的 total − netPaid 是全額（#898）
      .filter((invoice) => isOpenInvoice(invoice.status))
      .reduce((sum, invoice) => sum + (invoice.total - invoice.netPaid), 0);

    const period = ((termResult.data ?? []) as unknown as Array<Record<string, string>>)[0];
    const term = period
      ? {
          name: period['name']!,
          startDate: period['start_date']!,
          endDate: period['end_date']!,
          paid: allInvoices
            .filter(
              (invoice) =>
                invoice.status !== 'void' &&
                invoice.items.some((item) => item.billingPeriodId === period['id']),
            )
            .reduce((sum, invoice) => sum + invoice.netPaid, 0),
        }
      : null;

    return c.json(
      {
        data: mapped,
        meta: {
          total: allInvoices.length,
          counts,
          overdueSince: pendingDues.find((d) => d < today) ?? null,
          nextDue: pendingDues.find((d) => d >= today) ?? null,
          page,
          pageSize,
          totalDue,
          paymentInfo: paymentInfo.entries,
          term,
        },
      },
      200,
    );
  },
);

export default app;
