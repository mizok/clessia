import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { isChildAllowed } from '../../lib/child-scope';
import { INVOICE_SELECT, toInvoiceResponse, type InvoiceResponse } from '../../lib/invoice-query';
import { DbUuidSchema } from '../../lib/validation';

/**
 * 家長端的帳單列表。複用 `routes/invoices.ts`（admin）的 select 與 mapper
 * （`lib/invoice-query.ts`），換掉查詢用的 client（`supabase` → `childDb`），
 * 再過一層 **allowlist**（不是 denylist）映射砍掉內部備註與經手人 ——
 * allowlist 讓將來新增的欄位預設不外流，denylist 會預設外流。
 * 見 kb/wiki/architecture/parent-read-endpoints.md。
 */

const ParentInvoiceItemSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(['tuition', 'meal', 'session_pack', 'adjustment']),
    amount: z.number(),
    periodMonth: z.string().nullable(),
  })
  .openapi('ParentInvoiceItem');

const ParentPaymentRecordSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['payment', 'refund']),
    amount: z.number(),
    method: z.enum(['cash', 'transfer']),
    paidAt: z.string(),
    receiptNo: z.number().nullable(),
  })
  .openapi('ParentPaymentRecord');

const ParentInvoiceSchema = z
  .object({
    id: z.uuid(),
    issuedAt: z.string(),
    dueDate: z.string().nullable(),
    status: z.enum(['unpaid', 'partial', 'paid']),
    total: z.number(),
    netPaid: z.number(),
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
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1),
      /** 這個孩子全部未繳清帳單的 (total − netPaid) 加總，不分頁截斷 */
      totalDue: z.number(),
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
function toParentInvoice(invoice: InvoiceResponse) {
  return {
    id: invoice.id,
    issuedAt: invoice.issuedAt,
    dueDate: invoice.dueDate,
    status: invoice.status,
    total: invoice.total,
    netPaid: invoice.netPaid,
    items: invoice.items.map((item) => ({
      id: item.id,
      type: item.type,
      amount: item.amount,
      periodMonth: item.periodMonth,
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

    // `totalDue` 是**全部**帳單（不分頁）算出來的 —— 分頁截斷不能拿來算總額，
    // 跟出缺席／成績的 meta 同一個判準，所以另開一支不分頁的查詢。
    const [pageResult, allResult] = await Promise.all([
      childDb
        .from('invoices', 'student_id')
        .select(INVOICE_SELECT, { count: 'exact' })
        .eq('student_id', childId)
        .range(from, from + pageSize - 1)
        .order('issued_at', { ascending: false }),
      childDb.from('invoices', 'student_id').select(INVOICE_SELECT).eq('student_id', childId),
    ]);

    if (pageResult.error || allResult.error) {
      return c.json({ error: '讀取帳單失敗', code: 'FETCH_BILLING_FAILED' }, 500);
    }

    const pageRows = (pageResult.data ?? []) as unknown as Record<string, unknown>[];
    const allRows = (allResult.data ?? []) as unknown as Record<string, unknown>[];

    const mapped = pageRows.map((row) => toParentInvoice(toInvoiceResponse(row)));
    const totalDue = allRows
      .map((row) => toInvoiceResponse(row))
      .filter((invoice) => invoice.status !== 'paid')
      .reduce((sum, invoice) => sum + (invoice.total - invoice.netPaid), 0);

    return c.json(
      {
        data: mapped,
        meta: {
          total: pageResult.count ?? 0,
          page,
          pageSize,
          totalDue,
        },
      },
      200,
    );
  },
);

export default app;
