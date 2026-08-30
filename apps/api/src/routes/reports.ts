import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { aggregateRevenue, type RevenueInvoice, type RevenuePayment } from '../lib/revenue-report';

/**
 * 營收報表的聚合端點。
 *
 * **這支存在的理由是 `specs/admin/finance/reports.md` 的 🔴 實作陷阱**：列表 API 的
 * `pageSize` 上限是 100，抓一頁明細自己加總會在量大的月份**悄悄少算，而且錯得沒有
 * 任何徵兆**。所以報表的每個數字都從這裡出來，前端不做任何加總。
 *
 * 權限是 **`view_reports` 不是 `manage_finance`**（spec 有專節）：
 * `manage_finance` 是改價目表／開帳單／收款（**寫**），`view_reports` 是看營收（**唯讀**）。
 * 老闆可能只給主任看報表而不給動錢。
 *
 * ## 分校／課程怎麼歸屬
 *
 * 錢的歸屬要繞一圈：`payment_records → invoices → invoice_items → enrollments →
 * classes → campus/course`。而**一張帳單可以跨班**（同一個學生修兩科），也可以完全
 * 沒有班（純餐費帳單）。
 *
 * - **篩選**（`campusId` / `courseId`）＝「這張帳單有沒有沾到」，任一明細命中就算
 * - **分組**＝一張帳單只進一個組。跨兩個分校的進 `（跨分校）`，沒有班的進 `（未分類）`
 *
 * 刻意**不做比例拆分** —— 那會產生沒有人能跟收據對得起來的數字。也刻意**不重複計入
 * 多個組** —— 那會讓小計加起來大於總計。用一個看得見的「跨分校」組，代價是多一列，
 * 換來小計永遠加得回總計，而且模糊的地方是**明著標出來的**而不是藏起來的。
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CROSS_CAMPUS = '（跨分校）';
const CROSS_COURSE = '（跨課程）';
const UNCLASSIFIED = '（未分類）';

const FiguresSchema = z.object({
  received: z.number(),
  refunded: z.number(),
  billed: z.number(),
  outstanding: z.number(),
  overdueOutstanding: z.number(),
});

const app = new OpenAPIHono<AppEnv>();

/** 一張帳單的明細沾到哪些班 —— 巢狀 select 回來的形狀在這裡攤平 */
interface ClassContext {
  campusId: string | null;
  campusName: string | null;
  courseId: string | null;
  courseName: string | null;
}

function classContexts(invoiceRow: Record<string, unknown>): ClassContext[] {
  const items = (invoiceRow['invoice_items'] as Record<string, unknown>[] | null) ?? [];

  return items
    .map((item) => {
      const enrollment = item['enrollments'] as Record<string, unknown> | null;
      const cls = enrollment?.['classes'] as Record<string, unknown> | null;
      if (!cls) return null;
      return {
        campusId: (cls['campus_id'] as string | null) ?? null,
        campusName: (cls['campuses'] as { name?: string } | null)?.name ?? null,
        courseId: (cls['course_id'] as string | null) ?? null,
        courseName: (cls['courses'] as { name?: string } | null)?.name ?? null,
      };
    })
    .filter((ctx): ctx is ClassContext => ctx !== null);
}

/** 一張帳單進哪一組。跨組的進「（跨分校）」而不是重複計入或比例拆分 */
function groupKeyOf(
  contexts: ClassContext[],
  groupBy: 'campus' | 'course' | 'month',
  monthSource: string,
): string {
  if (groupBy === 'month') return monthSource.slice(0, 7);

  const names = Array.from(
    new Set(
      contexts
        .map((ctx) => (groupBy === 'campus' ? ctx.campusName : ctx.courseName))
        .filter((name): name is string => Boolean(name)),
    ),
  );

  if (names.length === 0) return UNCLASSIFIED;
  if (names.length === 1) return names[0] as string;
  return groupBy === 'campus' ? CROSS_CAMPUS : CROSS_COURSE;
}

function matchesFilter(
  contexts: ClassContext[],
  campusId: string | undefined,
  courseId: string | undefined,
): boolean {
  // 篩選是「沾到就算」—— 一張跨班的帳單只要有一筆明細在這個分校就進來
  if (campusId && !contexts.some((ctx) => ctx.campusId === campusId)) return false;
  if (courseId && !contexts.some((ctx) => ctx.courseId === courseId)) return false;
  return true;
}

const INVOICE_SELECT =
  'id, issued_at, due_date,' +
  ' invoice_items(amount, enrollments(classes(campus_id, course_id, campuses(name), courses(name)))),' +
  ' payment_records(kind, amount)';

// ============================================================
// GET /api/reports/revenue
// ============================================================
app.openapi(
  createRoute({
    method: 'get',
    path: '/revenue',
    tags: ['Reports'],
    summary: '營收摘要（實收／退款／應收未收）',
    request: {
      query: z.object({
        dateFrom: z.string().regex(DATE),
        dateTo: z.string().regex(DATE),
        campusId: z.uuid().optional(),
        courseId: z.uuid().optional(),
        groupBy: z.enum(['campus', 'course', 'month']).optional(),
      }),
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({
              summary: FiguresSchema,
              groups: z.array(FiguresSchema.extend({ key: z.string() })),
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
    const groupBy = params.groupBy ?? 'campus';
    const today = new Date().toISOString().slice(0, 10);

    const [{ data: paymentRows }, { data: invoiceRows }] = await Promise.all([
      // 實收／退款：**收款日**落在區間內，帳單開在什麼時候不影響
      supabase
        .from('payment_records')
        .select(`kind, amount, paid_at, invoices!inner(${INVOICE_SELECT})`)
        .eq('org_id', orgId)
        .gte('paid_at', params.dateFrom)
        .lte('paid_at', params.dateTo),
      // 應收未收：**開帳日**落在區間內的帳單，已收算它至今收到的全部
      // （三月開的帳單四月才繳，現在就不算欠了）
      supabase
        .from('invoices')
        .select(INVOICE_SELECT)
        .eq('org_id', orgId)
        .gte('issued_at', params.dateFrom)
        .lte('issued_at', params.dateTo),
    ]);

    const payments: RevenuePayment[] = [];
    for (const row of (paymentRows ?? []) as unknown as Record<string, unknown>[]) {
      const invoice = row['invoices'] as Record<string, unknown> | null;
      const contexts = invoice ? classContexts(invoice) : [];
      if (!matchesFilter(contexts, params.campusId, params.courseId)) continue;

      payments.push({
        kind: (row['kind'] as 'payment' | 'refund') ?? 'payment',
        amount: Number(row['amount']),
        groupKey: groupKeyOf(contexts, groupBy, row['paid_at'] as string),
      });
    }

    const invoices: RevenueInvoice[] = [];
    for (const row of (invoiceRows ?? []) as unknown as Record<string, unknown>[]) {
      const contexts = classContexts(row);
      if (!matchesFilter(contexts, params.campusId, params.courseId)) continue;

      const items = (row['invoice_items'] as Record<string, unknown>[] | null) ?? [];
      const records = (row['payment_records'] as Record<string, unknown>[] | null) ?? [];

      invoices.push({
        billed: items.reduce((sum, item) => sum + Number(item['amount']), 0),
        // 至今收到的**淨額**：退款要扣回去，否則退完款的帳單看起來還是繳清的
        paid: records.reduce(
          (sum, record) =>
            sum +
            (record['kind'] === 'refund' ? -Number(record['amount']) : Number(record['amount'])),
          0,
        ),
        dueDate: (row['due_date'] as string | null) ?? null,
        groupKey: groupKeyOf(contexts, groupBy, row['issued_at'] as string),
      });
    }

    return c.json(aggregateRevenue({ payments, invoices, today }), 200);
  },
);

export default app;
