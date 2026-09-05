import { deriveInvoiceStatus, invoiceTotals } from './invoice-status';

/**
 * 帳單的 select 字串與 row→回應的映射 —— **唯一定義**，`routes/invoices.ts`（admin）
 * 與 `routes/parent/billing.ts`（家長）共用，形狀照 `lib/session-summary.ts` 的先例
 * （檔頭原話：查詢條件可以不一樣，形狀不行，兩邊各長一份的話加欄位時總有一邊被忘記）。
 *
 * 家長端不是直接回這裡的形狀 —— 它再包一層 allowlist 砍掉 `note` / `recordedBy` /
 * `proofPath`（見 kb/wiki/architecture/parent-read-endpoints.md），但撈資料與推導
 * 狀態的邏輯是同一份。
 */
export const INVOICE_SELECT =
  'id, org_id, student_id, issued_at, due_date, note, created_by, created_at, updated_at,' +
  ' students(name),' +
  ' invoice_items(id, type, enrollment_id, amount, billing_period_id, period_month, note, created_at),' +
  ' payment_records(id, kind, amount, method, paid_at, proof_path, receipt_no, note, recorded_by, created_at)';

const ITEM_TYPES = ['tuition', 'meal', 'session_pack', 'adjustment'] as const;
const PAYMENT_KINDS = ['payment', 'refund'] as const;
const PAYMENT_METHODS = ['cash', 'transfer'] as const;

/** postgrest 的 numeric 回來是字串，加總前一定要 Number() */
function num(value: unknown): number {
  return Number(value ?? 0);
}

export function toInvoiceResponse(row: Record<string, unknown>) {
  const rawItems = (row['invoice_items'] as Record<string, unknown>[] | null) ?? [];
  const rawPayments = (row['payment_records'] as Record<string, unknown>[] | null) ?? [];

  const items = rawItems.map((item) => ({
    id: item['id'] as string,
    type: item['type'] as (typeof ITEM_TYPES)[number],
    enrollmentId: (item['enrollment_id'] as string | null) ?? null,
    amount: num(item['amount']),
    billingPeriodId: (item['billing_period_id'] as string | null) ?? null,
    periodMonth: (item['period_month'] as string | null) ?? null,
    note: (item['note'] as string | null) ?? null,
  }));

  const payments = rawPayments.map((payment) => ({
    id: payment['id'] as string,
    kind: payment['kind'] as (typeof PAYMENT_KINDS)[number],
    amount: num(payment['amount']),
    method: payment['method'] as (typeof PAYMENT_METHODS)[number],
    paidAt: payment['paid_at'] as string,
    proofPath: (payment['proof_path'] as string | null) ?? null,
    receiptNo: (payment['receipt_no'] as number | null) ?? null,
    note: (payment['note'] as string | null) ?? null,
    recordedBy: (payment['recorded_by'] as string | null) ?? null,
  }));

  const { total, net } = invoiceTotals(items, payments);
  const student = row['students'] as { name?: string } | null;

  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    studentId: row['student_id'] as string,
    studentName: student?.name ?? null,
    issuedAt: row['issued_at'] as string,
    dueDate: (row['due_date'] as string | null) ?? null,
    note: (row['note'] as string | null) ?? null,
    status: deriveInvoiceStatus(items, payments),
    total,
    netPaid: net,
    items,
    payments,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

export type InvoiceResponse = ReturnType<typeof toInvoiceResponse>;
