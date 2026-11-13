import type { Pool, PoolClient } from 'pg';

import type { CampusScope } from './campus-scope';
import { insertEnrollments, lockClassSeats } from './class-seats';
import { withTx } from './pg-tx';
import { monthRange, prorateByDays } from './proration';

/**
 * 建 `pending_payment` 報名＋開第一期帳單 —— 「家長申請核准」與「直接報名＋建立繳費單」（#2296 SD9）
 * **共用這一段**。錢只能有一份算法：兩份「首期怎麼算」只要一邊改了選期規則，同一個學生同一班
 * 同一天從兩個入口進來就會收不一樣的錢。
 *
 * 必須在呼叫端的 `withTx` 裡、**鎖班與範圍／名額檢查之後**呼叫。驗證全排在第一個 INSERT 之前，
 * 不符就回 outcome、什麼都沒寫；寫入後丟例外由 `withTx` 整筆回滾。
 *
 * 首期：月繳 = 生效起那個月；期繳 = 涵蓋生效起的繳費期；堂數制不按比例。
 * 金額 = `agreedAmount ?? 價目表` 依生效起～生效迄比例試算（同 `proration-preview`、月結 run）；
 * 行政可改，改了要寫原因（billing-rules 規則 2、enrollment-rules 5.3）。
 */

export interface FirstInvoiceInput {
  readonly orgId: string;
  readonly userId: string;
  readonly studentId: string;
  readonly classId: string;
  readonly billingMode: 'monthly' | 'period' | 'session_pack';
  readonly feeTemplateId: string;
  readonly agreedAmount: number | null;
  readonly adjustmentNote: string | null;
  readonly effectiveFrom: string;
  /** null = 讀到退班。月結 run 也用它算比例，首期不能不一樣 */
  readonly effectiveTo: string | null;
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
  /** 報名備註（直接報名表單的備註；核准沒有，給 null） */
  readonly notes: string | null;
}

export type FirstInvoiceOutcome =
  | { readonly status: 'already-enrolled' }
  | { readonly status: 'invalid-fee-template' }
  | { readonly status: 'no-billing-period' }
  | { readonly status: 'amount-note-required'; readonly suggested: number }
  | { readonly status: 'zero-amount' }
  | {
      readonly status: 'done';
      readonly enrollmentId: string;
      readonly invoiceId: string;
      readonly invoiceNo: string | null;
      readonly amount: number;
      readonly dueDate: string;
    };

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function enrollWithFirstInvoice(
  db: PoolClient,
  input: FirstInvoiceInput,
): Promise<FirstInvoiceOutcome> {
  const { orgId } = input;
  const { rows: tpls } = await db.query<{ amount: string }>(
    `SELECT amount FROM fee_templates
      WHERE id = $1 AND org_id = $2 AND is_active AND billing_mode::text = $3`,
    [input.feeTemplateId, orgId, input.billingMode],
  );
  const tpl = tpls[0];
  if (!tpl) return { status: 'invalid-fee-template' };
  const fullAmount = input.agreedAmount ?? Number(tpl.amount);
  const active = { from: input.effectiveFrom, to: input.effectiveTo };

  let periodMonth: string | null = null;
  let billingPeriodId: string | null = null;
  let suggested = fullAmount;
  let suggestedNote: string | null = null;
  if (input.billingMode === 'monthly') {
    periodMonth = `${input.effectiveFrom.slice(0, 7)}-01`;
    ({ amount: suggested, note: suggestedNote } = prorateByDays(
      fullAmount,
      monthRange(periodMonth),
      active,
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
      active,
    ));
  }

  const amount = input.amount ?? suggested;
  if (amount !== suggested && !input.amountNote?.trim()) {
    return { status: 'amount-note-required', suggested };
  }
  if (amount <= 0) return { status: 'zero-amount' };

  const inserted = await insertEnrollments(db, {
    orgId,
    classId: input.classId,
    rows: [
      {
        studentId: input.studentId,
        status: 'pending_payment',
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        billingMode: input.billingMode,
        feeTemplateId: input.feeTemplateId,
        agreedAmount: input.agreedAmount,
        adjustmentNote: input.adjustmentNote,
        notes: input.notes,
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
    [orgId, input.studentId, input.issuedAt, dueDate, input.userId],
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

  return {
    status: 'done',
    enrollmentId: enrollment.id,
    invoiceId: invoice.id,
    invoiceNo: invoice.invoice_no,
    amount,
    dueDate,
  };
}

export type DirectEnrollInvoiceOutcome =
  | { readonly status: 'not-found' }
  | { readonly status: 'over-quota'; readonly quota: number; readonly currentActive: number }
  | FirstInvoiceOutcome;

/**
 * 直接報名＋建立繳費單（#2296）：一個交易裡鎖班、數名額、範圍 → 共用段。
 * 範圍外跟不存在一樣回 not-found（c1；同核准），而且在名額之前判，不洩漏別校班的名額。
 */
export async function directEnrollWithFirstInvoice(
  pool: Pool,
  input: FirstInvoiceInput & { readonly scope: CampusScope },
): Promise<DirectEnrollInvoiceOutcome> {
  return withTx(pool, async (db): Promise<DirectEnrollInvoiceOutcome> => {
    const seats = await lockClassSeats(db, {
      orgId: input.orgId,
      classId: input.classId,
      studentIds: [input.studentId],
    });
    if (seats.status === 'not-found') return { status: 'not-found' };
    if (input.scope !== null && !input.scope.includes(seats.campusId)) {
      return { status: 'not-found' };
    }
    if (seats.status === 'over-quota') {
      return { status: 'over-quota', quota: seats.quota, currentActive: seats.currentActive };
    }
    return enrollWithFirstInvoice(db, input);
  });
}
