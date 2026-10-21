import type { Pool, PoolClient } from 'pg';

import { withTx } from './pg-tx';

/**
 * 班級名額：鎖班 → 數名額 → 寫報名，在**同一個交易**裡（#1726 Q9，計畫席 10-21 代裁）。
 *
 * 原本直接報名三條路（`POST /api/enrollments`、`/batch`、`/copy-from-class`）是先用
 * supabase-js 數名額、再另一個請求 insert —— 兩個人同時搶最後一位，兩個都數到「還有一位」。
 * 核准家長的報名申請（#1726）也要搶同一批位子，所以四條路**共用這一支**：
 * `FOR UPDATE` 鎖住班級那一列，別的交易要數名額得等這把鎖到 COMMIT／ROLLBACK。
 *
 * 佔名額 = `active`／`pending_payment`，跟 `routes/enrollments/validation.ts`、`child-db`、
 * `catalog-class` 同一個定義。規則見 `kb/wiki/architecture/pg-pool-writes.md`。
 */

/** 佔名額的報名狀態 */
const SEATED = ['active', 'pending_payment'];

export type SeatCheck =
  | { readonly status: 'not-found' }
  | {
      readonly status: 'over-quota';
      readonly campusId: string;
      readonly quota: number;
      readonly currentActive: number;
      readonly adding: number;
    }
  | { readonly status: 'ok'; readonly campusId: string };

/**
 * 在呼叫端的交易裡鎖班、數名額。**必須在 `withTx` 裡呼叫** —— 鎖到交易結束才放，
 * 呼叫端要在同一個交易裡 insert，名額判斷才算數。
 *
 * `adding` = 這批學生裡還沒佔這班名額的人數（已在班上的不重複算），同 `checkEnrollmentPreconditions` 原本的算法。
 */
export async function lockClassSeats(
  db: PoolClient,
  input: {
    readonly orgId: string;
    readonly classId: string;
    readonly studentIds: readonly string[];
  },
): Promise<SeatCheck> {
  const ids = [...new Set(input.studentIds)];
  const { rows: found } = await db.query<{ max_students: number | null; campus_id: string }>(
    'SELECT max_students, campus_id FROM classes WHERE id = $1 AND org_id = $2 FOR UPDATE',
    [input.classId, input.orgId],
  );
  const cls = found[0];
  if (!cls) return { status: 'not-found' };

  const { rows: counted } = await db.query<{ taken: string; already: string }>(
    `SELECT count(*) AS taken,
            count(*) FILTER (WHERE student_id = ANY($3::uuid[])) AS already
       FROM enrollments
      WHERE class_id = $1 AND org_id = $2 AND status::text = ANY($4::text[])`,
    [input.classId, input.orgId, ids, SEATED],
  );
  const currentActive = Number(counted[0]?.taken ?? 0);
  const adding = ids.length - Number(counted[0]?.already ?? 0);

  if (cls.max_students !== null && currentActive + adding > cls.max_students) {
    return {
      status: 'over-quota',
      campusId: cls.campus_id,
      quota: cls.max_students,
      currentActive,
      adding,
    };
  }
  return { status: 'ok', campusId: cls.campus_id };
}

export interface NewEnrollment {
  readonly studentId: string;
  readonly status: 'active' | 'pending_payment';
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly billingMode?: string | null;
  readonly feeTemplateId?: string | null;
  readonly agreedAmount?: number | null;
  readonly adjustmentNote?: string | null;
  readonly notes?: string | null;
  readonly createdBy: string;
}

/**
 * 在呼叫端的交易裡寫報名，一句寫完。已在班上（`enrollments_active_class_student_unique`）的跳過、
 * 不丟例外 —— 23505 會讓整個交易中止，批次裡一個重複就會拖垮其餘的人。
 * 回傳實際寫入的列；呼叫端拿 `studentId` 對回哪些人被跳過。
 */
export async function insertEnrollments(
  db: PoolClient,
  input: {
    readonly orgId: string;
    readonly classId: string;
    readonly rows: readonly NewEnrollment[];
  },
): Promise<Array<{ id: string; studentId: string }>> {
  if (input.rows.length === 0) return [];
  const payload = input.rows.map((r) => ({
    student_id: r.studentId,
    status: r.status,
    effective_from: r.effectiveFrom,
    effective_to: r.effectiveTo ?? null,
    billing_mode: r.billingMode ?? null,
    fee_template_id: r.feeTemplateId ?? null,
    agreed_amount: r.agreedAmount ?? null,
    adjustment_note: r.adjustmentNote ?? null,
    notes: r.notes ?? null,
    created_by: r.createdBy,
  }));
  const { rows } = await db.query<{ id: string; student_id: string }>(
    `INSERT INTO enrollments (org_id, class_id, student_id, status, effective_from, effective_to,
                              billing_mode, fee_template_id, agreed_amount, adjustment_note, notes, created_by)
     SELECT $1, $2, r.student_id, r.status, r.effective_from, r.effective_to,
            r.billing_mode, r.fee_template_id, r.agreed_amount, r.adjustment_note, r.notes, r.created_by
       FROM jsonb_to_recordset($3::jsonb) AS r(
              student_id uuid, status public.enrollment_status, effective_from date, effective_to date,
              billing_mode public.billing_mode, fee_template_id uuid, agreed_amount numeric,
              adjustment_note text, notes text, created_by text)
     ON CONFLICT (class_id, student_id) WHERE status NOT IN ('withdrawal', 'void') DO NOTHING
     RETURNING id, student_id`,
    [input.orgId, input.classId, JSON.stringify(payload)],
  );
  return rows.map((r) => ({ id: r.id, studentId: r.student_id }));
}

export type EnrollOutcome =
  | Exclude<SeatCheck, { status: 'ok' }>
  | { readonly status: 'done'; readonly inserted: Array<{ id: string; studentId: string }> };

/**
 * 直接報名三條路用的：一個交易裡鎖班、數名額、寫報名。
 * 名額不夠整批不寫（同原本的行為：先數、超過就 400，一個都不加）。
 */
export async function enrollWithSeatLock(
  pool: Pool,
  input: {
    readonly orgId: string;
    readonly classId: string;
    readonly rows: readonly NewEnrollment[];
  },
): Promise<EnrollOutcome> {
  return withTx(pool, async (db) => {
    const seats = await lockClassSeats(db, {
      orgId: input.orgId,
      classId: input.classId,
      studentIds: input.rows.map((r) => r.studentId),
    });
    if (seats.status !== 'ok') return seats;
    return { status: 'done', inserted: await insertEnrollments(db, input) } as const;
  });
}
