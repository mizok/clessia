import type { Pool } from 'pg';

import { deriveInvoiceStatus, invoiceTotals, type PaymentRow } from './invoice-status';
import { withTx } from './pg-tx';

/**
 * 記一筆收款或退費（#1778，設計稿 `kb/wiki/specs/admin/enrollment/payment-activation.md` §2.1）。
 *
 * 一個交易裡：鎖帳單 → 作廢擋 → 退費在鎖內重數淨額 → 寫收款（收據號 trigger 照常取號）→
 * 收款（不是退費）才做：
 * 1. 這張帳單明細上還是 `pending_payment` 的報名 → `active`（第一筆收款就轉，含定金，Q1 (a)；
 *    一張帳單多個報名照帳單算，Q6）
 * 2. 推導後繳清 → 連到這張帳單明細報名的 `awaiting_payment` 申請 → `completed`
 *    （用「本帳單明細的報名」而不是只用 1. 剛轉的：報名可能先因定金轉了，繳清那一筆才完成申請）
 *
 * 退費不倒轉（Q3）。帳單的分校範圍由呼叫端先查（`findScopedInvoice`），這裡只守 org。
 */

export interface RecordPaymentInput {
  readonly orgId: string;
  readonly userId: string;
  readonly invoiceId: string;
  readonly kind: 'payment' | 'refund';
  readonly amount: number;
  readonly method: string;
  readonly paidAt: string;
  readonly proofPath: string | null;
  readonly note: string | null;
  /** 報名轉正式的 `status_changed_at`（台北今天），由呼叫端給 —— 這裡不碰時鐘 */
  readonly today: string;
}

export interface ChangedRow {
  readonly id: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly className: string;
}

export type RecordPaymentOutcome =
  | { readonly status: 'not-found' }
  | { readonly status: 'voided' }
  | { readonly status: 'refund-exceeds-paid'; readonly net: number }
  | {
      readonly status: 'done';
      readonly paymentId: string;
      readonly activated: readonly ChangedRow[];
      readonly completed: readonly ChangedRow[];
    };

const toChanged = (r: Record<string, unknown>): ChangedRow => ({
  id: r['id'] as string,
  studentId: r['student_id'] as string,
  studentName: (r['student_name'] as string | null) ?? '',
  className: (r['class_name'] as string | null) ?? '',
});

/** 本帳單明細上的報名（明細刪掉就不算） */
const INVOICE_ENROLLMENTS = `SELECT enrollment_id FROM invoice_items
  WHERE invoice_id = $1 AND enrollment_id IS NOT NULL`;

export async function recordPayment(
  pool: Pool,
  input: RecordPaymentInput,
): Promise<RecordPaymentOutcome> {
  return withTx(pool, async (db) => {
    const { orgId, invoiceId } = input;

    const inv = await db.query<{ voided_at: string | null }>(
      `SELECT voided_at FROM invoices WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [invoiceId, orgId],
    );
    if (inv.rows.length === 0) return { status: 'not-found' };
    if (inv.rows[0]!.voided_at) return { status: 'voided' };

    // 帳單鎖住之後才數 —— 兩筆退費同時進來，第二筆會等第一筆 COMMIT 再讀到新淨額
    const paid = await db.query<{ kind: 'payment' | 'refund'; amount: string }>(
      `SELECT kind, amount FROM payment_records WHERE invoice_id = $1 AND org_id = $2`,
      [invoiceId, orgId],
    );
    const payments: PaymentRow[] = paid.rows.map((r) => ({
      kind: r.kind,
      amount: Number(r.amount),
    }));
    if (input.kind === 'refund') {
      const { net } = invoiceTotals([], payments);
      if (input.amount > net) return { status: 'refund-exceeds-paid', net };
    }

    const ins = await db.query<{ id: string }>(
      `INSERT INTO payment_records
         (org_id, invoice_id, kind, amount, method, paid_at, proof_path, note, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        orgId,
        invoiceId,
        input.kind,
        input.amount,
        input.method,
        input.paidAt,
        input.proofPath,
        input.note,
        input.userId,
      ],
    );
    const paymentId = ins.rows[0]!.id;
    if (input.kind === 'refund') return { status: 'done', paymentId, activated: [], completed: [] };

    const activated = await db.query(
      `WITH done AS (
         UPDATE enrollments SET status = 'active', status_changed_at = $3
          WHERE org_id = $2 AND status = 'pending_payment' AND id IN (${INVOICE_ENROLLMENTS})
          RETURNING id, student_id, class_id)
       SELECT d.id, d.student_id, s.name AS student_name, c.name AS class_name
         FROM done d JOIN students s ON s.id = d.student_id JOIN classes c ON c.id = d.class_id`,
      [invoiceId, orgId, input.today],
    );

    const items = await db.query<{ amount: string }>(
      `SELECT amount FROM invoice_items WHERE invoice_id = $1`,
      [invoiceId],
    );
    const status = deriveInvoiceStatus(
      items.rows.map((r) => ({ amount: Number(r.amount) })),
      [...payments, { kind: 'payment', amount: input.amount }],
      false,
    );

    const completed =
      status === 'paid'
        ? await db.query(
            `WITH done AS (
               UPDATE enrollment_requests SET status = 'completed'
                WHERE org_id = $2 AND status = 'awaiting_payment'
                  AND enrollment_id IN (${INVOICE_ENROLLMENTS})
                RETURNING id, student_id, class_id)
             SELECT d.id, d.student_id, s.name AS student_name, c.name AS class_name
               FROM done d JOIN students s ON s.id = d.student_id LEFT JOIN classes c ON c.id = d.class_id`,
            [invoiceId, orgId],
          )
        : { rows: [] };

    return {
      status: 'done',
      paymentId,
      activated: activated.rows.map(toChanged),
      completed: completed.rows.map(toChanged),
    };
  });
}
