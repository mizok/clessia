import type { Queryable } from './identity-sql';
import type { PlannedTuitionItem } from './billing-run';
import { alreadyBilledViaSql } from './billing-run-sql';

/**
 * 帳務作業的寫入：**每位學生一筆交易**（#1943，計畫席 10-23 裁定）。呼叫端用 `withTx` 包。
 *
 * **為什麼**：原本每位學生依序打 4～5 支 supabase-js 寫入，每支一個 PostgREST 交易、錯誤幾乎沒檢查：
 * - 學費明細 insert 失敗 → 留下沒有明細的空帳單，回應照樣成功
 * - Workers 免費方案每個請求 50 個 subrequest，supabase-js 每句都算一個 → **月結大概十位學生就跑到一半失敗**，
 *   前面的開了、後面的沒開（repo 已有三處因此改寫：`sessions.ts`、`utils/audit.ts`、`lib/notify.ts`）
 * 經 `auth.pool`（Hyperdrive）走 pg 不算 subrequest；一位學生的讀寫都在同一條連線、同一筆交易。
 *
 * 規則照 `kb/wiki/architecture/pg-pool-writes.md`：參數化 SQL、每句帶 `org_id`、
 * **冪等在交易裡重做**（`FOR UPDATE` 鎖住這位學生要開的報名再查一次，同一個月同時按兩次 run 也不會重複開）、
 * 交易裡不做對外 I/O（稽核在交易外）。
 */

export interface StudentBillInput {
  readonly orgId: string;
  readonly userId: string;
  readonly studentId: string;
  readonly issuedAt: string;
  readonly dueDate: string;
  readonly invoiceNote: string;
  readonly periodMonth: string | null;
  readonly billingPeriodId: string | null;
  readonly range: { readonly start: string; readonly end: string };
  /** 交易外規劃好的學費（`planTuitionItems`）；交易裡會再確認一次沒開過 */
  readonly tuition: readonly PlannedTuitionItem[];
  /** 交易外判斷這位學生有待開餐費；實際蓋到幾筆以交易裡的 UPDATE 為準 */
  readonly withMeal: boolean;
  readonly mealNote: string;
}

export interface StudentBillResult {
  readonly tuitionItems: number;
  readonly mealItem: boolean;
  readonly mealRecords: number;
}

/**
 * 這位學生這次沒有任何東西可開（交易裡重查後學費都開過了、餐費也被別的 run 先蓋走）。
 * 丟這個讓交易 ROLLBACK —— **不開空帳單**。呼叫端把它當「略過」，不算失敗。
 */
export class NothingToBill extends Error {
  constructor() {
    super('NOTHING_TO_BILL');
  }
}

export async function billStudent(db: Queryable, p: StudentBillInput): Promise<StudentBillResult> {
  // 1. 冪等在交易裡重做：先鎖住這位學生要開的報名，別的 run 要等這筆交易結束才查得到
  let tuition = [...p.tuition];
  if (tuition.length > 0) {
    await db.query(
      'select id from public.enrollments where org_id = $1::uuid and id = any($2::uuid[]) for update',
      [p.orgId, tuition.map((t) => t.enrollmentId)],
    );
    const billed = await alreadyBilledViaSql(db, {
      orgId: p.orgId,
      enrollmentIds: tuition.map((t) => t.enrollmentId),
      periodMonth: p.periodMonth,
      billingPeriodId: p.billingPeriodId,
    });
    tuition = tuition.filter((t) => !billed.has(t.enrollmentId));
  }
  if (tuition.length === 0 && !p.withMeal) throw new NothingToBill();

  // 2. 帳單（invoice_no 由既有的 BEFORE INSERT trigger 取號；計數器的鎖握到這筆交易結束）
  const { rows: invoiceRows } = await db.query(
    `insert into public.invoices (org_id, student_id, issued_at, due_date, note, created_by)
     values ($1::uuid, $2::uuid, $3::date, $4::date, $5, $6) returning id`,
    [p.orgId, p.studentId, p.issuedAt, p.dueDate, p.invoiceNote, p.userId],
  );
  const invoiceId = (invoiceRows[0] as { id: string }).id;

  // 3. 學費明細
  if (tuition.length > 0) {
    await db.query(
      `insert into public.invoice_items
         (invoice_id, type, enrollment_id, amount, billing_period_id, period_month, note)
       select $1::uuid, 'tuition', t.enrollment_id, t.amount, $4::uuid, $5::date, t.note
         from unnest($2::uuid[], $3::numeric[], $6::text[]) as t(enrollment_id, amount, note)`,
      [
        invoiceId,
        tuition.map((t) => t.enrollmentId),
        tuition.map((t) => t.amount),
        p.billingPeriodId,
        p.periodMonth,
        tuition.map((t) => t.note),
      ],
    );
  }

  // 4. 餐費：開 item → 蓋章 → 金額＝蓋章總額，**一句做完**。同一筆交易裡不會再有「0 元＋已蓋章」的中間態
  let mealRecords = 0;
  if (p.withMeal) {
    const { rows: itemRows } = await db.query(
      `insert into public.invoice_items (invoice_id, type, amount, period_month, note)
       values ($1::uuid, 'meal', 0, $2::date, $3) returning id`,
      [invoiceId, p.periodMonth, p.mealNote],
    );
    const mealItemId = (itemRows[0] as { id: string }).id;
    const { rows: stampedRows } = await db.query(
      `with stamped as (
         update public.meal_records
            set invoice_item_id = $1::uuid
          where org_id = $2::uuid and student_id = $3::uuid
            and meal_date between $4::date and $5::date
            and ordered and chargeable and invoice_item_id is null
         returning unit_price
       )
       update public.invoice_items
          set amount = (select coalesce(sum(unit_price), 0) from stamped)
        where id = $1::uuid
       returning (select count(*) from stamped)::int as n`,
      [mealItemId, p.orgId, p.studentId, p.range.start, p.range.end],
    );
    mealRecords = (stampedRows[0] as { n: number }).n;
    // 交易外看到有待開餐費、交易裡卻一筆都沒蓋到（別的 run 先蓋走了）→ 不留 0 元的餐費 item
    if (mealRecords === 0) {
      await db.query('delete from public.invoice_items where id = $1::uuid', [mealItemId]);
    }
  }

  // 5. 不開空帳單
  if (tuition.length === 0 && mealRecords === 0) throw new NothingToBill();

  return { tuitionItems: tuition.length, mealItem: mealRecords > 0, mealRecords };
}
