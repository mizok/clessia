import type { Pool } from 'pg';

import type { CampusScope } from './campus-scope';
import { insertEnrollments, lockClassSeats } from './class-seats';
import { withTx } from './pg-tx';
import { monthRange, prorateByDays } from './proration';

/**
 * 核准家長的報名申請（#1726，設計稿 `kb/wiki/specs/admin/enrollment/approve-request.md` §2）。
 *
 * 一個交易裡：鎖申請 → 鎖班、數名額（跟直接報名共用 `lockClassSeats`）→ 驗價目表與繳費期 →
 * 建 `pending_payment` 報名 → 開帳單＋一列明細（填月份／期別，月結批次的冪等才認得）→
 * 堂數制多一列 `session_packs` → 申請轉 `awaiting_payment` 並寫 `enrollment_id`。
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

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

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

    const { rows: tpls } = await db.query<{ amount: string }>(
      `SELECT amount FROM fee_templates
        WHERE id = $1 AND org_id = $2 AND is_active AND billing_mode::text = $3`,
      [input.feeTemplateId, orgId, input.billingMode],
    );
    const tpl = tpls[0];
    if (!tpl) return { status: 'invalid-fee-template' };
    const fullAmount = input.agreedAmount ?? Number(tpl.amount);

    // 首期的「期」：月繳 = 生效起那個月；期繳 = 涵蓋生效起的繳費期；堂數制不按比例
    let periodMonth: string | null = null;
    let billingPeriodId: string | null = null;
    let suggested = fullAmount;
    let suggestedNote: string | null = null;
    if (input.billingMode === 'monthly') {
      periodMonth = `${input.effectiveFrom.slice(0, 7)}-01`;
      ({ amount: suggested, note: suggestedNote } = prorateByDays(
        fullAmount,
        monthRange(periodMonth),
        { from: input.effectiveFrom, to: null },
      ));
    } else if (input.billingMode === 'period') {
      // ponytail: 期間重疊時取最晚開始的那期；機構自建的期理論上不重疊
      const { rows: periods } = await db.query<{
        id: string;
        start_date: string;
        end_date: string;
      }>(
        `SELECT id, start_date::text, end_date::text FROM billing_periods
          WHERE org_id = $1 AND start_date <= $2::date AND end_date >= $2::date
          ORDER BY start_date DESC LIMIT 1`,
        [orgId, input.effectiveFrom],
      );
      const period = periods[0];
      if (!period) return { status: 'no-billing-period' };
      billingPeriodId = period.id;
      ({ amount: suggested, note: suggestedNote } = prorateByDays(
        fullAmount,
        { start: period.start_date, end: period.end_date },
        { from: input.effectiveFrom, to: null },
      ));
    }

    const amount = input.amount ?? suggested;
    if (amount !== suggested && !input.amountNote?.trim()) {
      return { status: 'amount-note-required', suggested };
    }
    if (amount <= 0) return { status: 'zero-amount' };

    const inserted = await insertEnrollments(db, {
      orgId,
      classId: req.class_id,
      rows: [
        {
          studentId: req.student_id,
          status: 'pending_payment',
          effectiveFrom: input.effectiveFrom,
          billingMode: input.billingMode,
          feeTemplateId: input.feeTemplateId,
          agreedAmount: input.agreedAmount,
          adjustmentNote: input.adjustmentNote,
          createdBy: input.userId,
        },
      ],
    });
    const enrollment = inserted[0];
    if (!enrollment) return { status: 'already-enrolled' };

    let dueDate = input.dueDate;
    if (!dueDate) {
      const { rows: orgs } = await db.query<{ invoice_due_days: number | null }>(
        'SELECT invoice_due_days FROM organizations WHERE id = $1',
        [orgId],
      );
      dueDate = addDays(input.issuedAt, Number(orgs[0]?.invoice_due_days ?? 14));
    }

    const { rows: invs } = await db.query<{ id: string; invoice_no: string | null }>(
      `INSERT INTO invoices (org_id, student_id, issued_at, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, invoice_no`,
      [orgId, req.student_id, input.issuedAt, dueDate, input.userId],
    );
    const invoice = invs[0]!;

    const { rows: items } = await db.query<{ id: string }>(
      `INSERT INTO invoice_items (invoice_id, type, enrollment_id, amount, period_month, billing_period_id, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        invoice.id,
        input.billingMode === 'session_pack' ? 'session_pack' : 'tuition',
        enrollment.id,
        amount,
        periodMonth,
        billingPeriodId,
        input.amountNote?.trim() || suggestedNote,
      ],
    );

    if (input.billingMode === 'session_pack') {
      await db.query(
        `INSERT INTO session_packs (org_id, enrollment_id, purchased_count, purchased_at, invoice_item_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orgId, enrollment.id, input.sessionCount, input.issuedAt, items[0]!.id, input.userId],
      );
    }

    await db.query(
      `UPDATE enrollment_requests SET status = 'awaiting_payment', enrollment_id = $1, updated_at = now()
        WHERE id = $2 AND org_id = $3`,
      [enrollment.id, input.requestId, orgId],
    );

    return {
      status: 'done',
      studentId: req.student_id,
      classId: req.class_id,
      enrollmentId: enrollment.id,
      invoiceId: invoice.id,
      invoiceNo: invoice.invoice_no,
      amount,
      dueDate,
    };
  });
}
