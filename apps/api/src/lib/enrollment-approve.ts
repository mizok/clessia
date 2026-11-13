import type { Pool } from 'pg';

import type { CampusScope } from './campus-scope';
import { lockClassSeats } from './class-seats';
import { enrollWithFirstInvoice } from './enrollment-first-invoice';
import { withTx } from './pg-tx';

/**
 * 核准家長的報名申請（#1726，設計稿 `kb/wiki/specs/admin/enrollment/approve-request.md` §2）。
 *
 * 一個交易裡：鎖申請 → 鎖班、數名額（跟直接報名共用 `lockClassSeats`）→
 * 建報名＋開第一期帳單（跟「直接報名＋建立繳費單」共用 `enrollWithFirstInvoice`，#2296）→
 * 申請轉 `awaiting_payment` 並寫 `enrollment_id`。
 * 任何一步不符整筆回滾 —— 不能留下有報名沒帳單、或有帳單但申請還在待審核。
 *
 * 金額一律伺服器算（同 `proration-preview`）：首期 = `agreedAmount ?? 價目表` 依生效起比例試算；
 * 行政可改，改了要寫原因（billing-rules 規則 2、enrollment-rules 5.3）。
 */

export interface ApproveInput {
  readonly orgId: string;
  readonly userId: string;
  readonly requestId: string;
  readonly scope: CampusScope;
  readonly billingMode: 'monthly' | 'period' | 'session_pack';
  readonly feeTemplateId: string;
  readonly agreedAmount: number | null;
  readonly adjustmentNote: string | null;
  readonly effectiveFrom: string;
  /** 行政改過的首期金額；null = 用試算值 */
  readonly amount: number | null;
  /** 首期金額跟試算不同時必填 */
  readonly amountNote: string | null;
  /** 開帳日（台北今天），由呼叫端給 —— 這裡不碰時鐘 */
  readonly issuedAt: string;
  /** null = 開帳日 + `organizations.invoice_due_days` */
  readonly dueDate: string | null;
  /** 堂數制必填 */
  readonly sessionCount: number | null;
}

export type ApproveOutcome =
  | { readonly status: 'not-found' }
  | { readonly status: 'not-approvable'; readonly current: string }
  | { readonly status: 'class-full' }
  | { readonly status: 'already-enrolled' }
  | { readonly status: 'invalid-fee-template' }
  | { readonly status: 'no-billing-period' }
  | { readonly status: 'amount-note-required'; readonly suggested: number }
  | { readonly status: 'zero-amount' }
  | {
      readonly status: 'done';
      readonly studentId: string;
      readonly classId: string;
      readonly enrollmentId: string;
      readonly invoiceId: string;
      readonly invoiceNo: string | null;
      readonly amount: number;
      readonly dueDate: string;
    };

const APPROVABLE = ['pending', 'waitlist'];

export async function approveEnrollmentRequest(
  pool: Pool,
  input: ApproveInput,
): Promise<ApproveOutcome> {
  const { orgId } = input;
  return withTx(pool, async (db): Promise<ApproveOutcome> => {
    const { rows: reqs } = await db.query<{ status: string; student_id: string; class_id: string }>(
      'SELECT status, student_id, class_id FROM enrollment_requests WHERE id = $1 AND org_id = $2 FOR UPDATE',
      [input.requestId, orgId],
    );
    const req = reqs[0];
    if (!req) return { status: 'not-found' };

    const seats = await lockClassSeats(db, {
      orgId,
      classId: req.class_id,
      studentIds: [req.student_id],
    });
    if (seats.status === 'not-found') return { status: 'not-found' };
    // 範圍外跟不存在一樣（c1；分校看班，同 parent-requests 收件頁）
    if (input.scope !== null && !input.scope.includes(seats.campusId)) {
      return { status: 'not-found' };
    }
    if (!APPROVABLE.includes(req.status)) return { status: 'not-approvable', current: req.status };
    if (seats.status === 'over-quota') return { status: 'class-full' };

    const r = await enrollWithFirstInvoice(db, {
      orgId,
      userId: input.userId,
      studentId: req.student_id,
      classId: req.class_id,
      billingMode: input.billingMode,
      feeTemplateId: input.feeTemplateId,
      agreedAmount: input.agreedAmount,
      adjustmentNote: input.adjustmentNote,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
      amount: input.amount,
      amountNote: input.amountNote,
      issuedAt: input.issuedAt,
      dueDate: input.dueDate,
      sessionCount: input.sessionCount,
      notes: null,
    });
    if (r.status !== 'done') return r;

    await db.query(
      `UPDATE enrollment_requests SET status = 'awaiting_payment', enrollment_id = $1, updated_at = now()
        WHERE id = $2 AND org_id = $3`,
      [r.enrollmentId, input.requestId, orgId],
    );

    return { ...r, studentId: req.student_id, classId: req.class_id };
  });
}
