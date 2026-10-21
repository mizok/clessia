import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordPayment, type RecordPaymentInput } from '../lib/record-payment';

/**
 * #1778：記收款的交易對**真的** Postgres 跑 —— 鎖帳單後重數淨額、收據號 trigger、
 * 報名轉正式與申請完成的條件，這些是 SQL 語意，替身驗不出來。
 * 自己建資料、測完刪掉，不碰 seed（只借一個既有 ba_user 當記錄人：c2 不寫 ba_*）。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

run('記收款的交易對真 Postgres（#1778）', () => {
  const pool = new Pool({ connectionString: DB });
  const orgs: string[] = [];
  let userId = '';

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const one = async (sql: string, params: unknown[]) =>
    (await q<{ id: string }>(`${sql} RETURNING id`, params))[0]!.id;
  const status = async (table: string, id: string) =>
    (await q<{ status: string }>(`SELECT status::text FROM ${table} WHERE id = $1`, [id]))[0]!
      .status;

  async function newOrg() {
    const orgId = await one(`INSERT INTO organizations (name) VALUES ($1)`, [
      `c1778-${randomUUID()}`,
    ]);
    orgs.push(orgId);
    const campusId = await one(`INSERT INTO campuses (org_id, name) VALUES ($1, 'x')`, [orgId]);
    const subjectId = await one(`INSERT INTO subjects (org_id, name) VALUES ($1, 'x')`, [orgId]);
    const courseId = await one(
      `INSERT INTO courses (org_id, campus_id, subject_id, name) VALUES ($1, $2, $3, 'x')`,
      [orgId, campusId, subjectId],
    );
    const classId = await one(
      `INSERT INTO classes (org_id, campus_id, course_id, name) VALUES ($1, $2, $3, '數學A')`,
      [orgId, campusId, courseId],
    );
    return { orgId, classId };
  }

  /** 一個學生在這班的報名（狀態 `status`），連到它的申請（`awaiting_payment`） */
  async function enrollee(orgId: string, classId: string, status = 'pending_payment') {
    const studentId = await one(
      `INSERT INTO students (org_id, name, grade) VALUES ($1, '小明', 'J1')`,
      [orgId],
    );
    const enrollmentId = await one(
      `INSERT INTO enrollments (org_id, class_id, student_id, status, effective_from)
       VALUES ($1, $2, $3, $4, '2026-10-01')`,
      [orgId, classId, studentId, status],
    );
    const requestId = await one(
      `INSERT INTO enrollment_requests (org_id, student_id, class_id, status, enrollment_id, requested_by)
       VALUES ($1, $2, $3, 'awaiting_payment', $4, $5)`,
      [orgId, studentId, classId, enrollmentId, userId],
    );
    return { studentId, enrollmentId, requestId };
  }

  /** 一張帳單，每個報名一列明細 `amount` 元 */
  async function invoice(orgId: string, studentId: string, enrollmentIds: string[], amount = 3000) {
    const invoiceId = await one(`INSERT INTO invoices (org_id, student_id) VALUES ($1, $2)`, [
      orgId,
      studentId,
    ]);
    for (const e of enrollmentIds) {
      await q(
        `INSERT INTO invoice_items (invoice_id, type, enrollment_id, amount) VALUES ($1, 'tuition', $2, $3)`,
        [invoiceId, e, amount],
      );
    }
    return invoiceId;
  }

  const pay = (
    orgId: string,
    invoiceId: string,
    amount: number,
    kind: RecordPaymentInput['kind'] = 'payment',
  ) =>
    recordPayment(pool, {
      orgId,
      userId,
      invoiceId,
      kind,
      amount,
      method: 'cash',
      paidAt: '2026-10-21',
      proofPath: null,
      note: null,
      today: '2026-10-21',
    });

  beforeAll(async () => {
    userId = (await q<{ id: string }>('SELECT id FROM ba_user LIMIT 1'))[0]!.id;
  });
  afterAll(async () => {
    if (orgs.length) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query('SET LOCAL session_replication_role = replica');
        await db.query(
          'DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE org_id = ANY($1))',
          [orgs],
        );
        for (const t of [
          'payment_records',
          'invoices',
          'enrollment_requests',
          'enrollments',
          'classes',
          'courses',
          'students',
          'subjects',
          'campuses',
        ]) {
          await db.query(`DELETE FROM ${t} WHERE org_id = ANY($1)`, [orgs]);
        }
        await db.query('COMMIT');
      } finally {
        db.release();
      }
      await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [orgs]);
    }
    await pool.end();
  });

  it('定金（部分繳）：報名轉 active、記 status_changed_at；申請還在 awaiting_payment', async () => {
    const { orgId, classId } = await newOrg();
    const s = await enrollee(orgId, classId);
    const inv = await invoice(orgId, s.studentId, [s.enrollmentId]);

    const r = await pay(orgId, inv, 1000);

    expect(r.status).toBe('done');
    if (r.status !== 'done') return;
    expect(r.activated).toEqual([
      {
        id: s.enrollmentId,
        studentId: s.studentId,
        studentName: '小明',
        className: '數學A',
        classId,
        effectiveFrom: '2026-10-01',
        effectiveTo: null,
      },
    ]);
    expect(r.completed).toEqual([]);
    const [e] = await q<{ status: string; d: string }>(
      `SELECT status::text, status_changed_at::text AS d FROM enrollments WHERE id = $1`,
      [s.enrollmentId],
    );
    expect(e).toEqual({ status: 'active', d: '2026-10-21' });
    expect(await status('enrollment_requests', s.requestId)).toBe('awaiting_payment');
    // 收據號照常由 trigger 取
    const [p] = await q<{ receipt_no: number | null }>(
      `SELECT receipt_no FROM payment_records WHERE id = $1`,
      [r.paymentId],
    );
    expect(p!.receipt_no).not.toBeNull();
  });

  it('繳清那一筆：申請轉 completed（報名早已因定金轉正式，activated 是空的）', async () => {
    const { orgId, classId } = await newOrg();
    const s = await enrollee(orgId, classId);
    const inv = await invoice(orgId, s.studentId, [s.enrollmentId]);
    await pay(orgId, inv, 1000);

    const r = await pay(orgId, inv, 2000);

    expect(r.status === 'done' && r.activated).toEqual([]);
    expect(r.status === 'done' && r.completed.map((x) => x.id)).toEqual([s.requestId]);
    expect(await status('enrollment_requests', s.requestId)).toBe('completed');
  });

  it('一次繳清：同一筆裡報名轉正式、申請完成', async () => {
    const { orgId, classId } = await newOrg();
    const s = await enrollee(orgId, classId);
    const inv = await invoice(orgId, s.studentId, [s.enrollmentId]);

    const r = await pay(orgId, inv, 3000);

    expect(r.status === 'done' && r.activated.map((x) => x.id)).toEqual([s.enrollmentId]);
    expect(r.status === 'done' && r.completed.map((x) => x.id)).toEqual([s.requestId]);
  });

  it('一張帳單兩個報名：照帳單算，第一筆收款兩個都轉正式（Q6）', async () => {
    const { orgId, classId } = await newOrg();
    const a = await enrollee(orgId, classId);
    const b = await enrollee(orgId, classId);
    const inv = await invoice(orgId, a.studentId, [a.enrollmentId, b.enrollmentId]);

    const r = await pay(orgId, inv, 500);

    expect(r.status === 'done' && r.activated.map((x) => x.id).sort()).toEqual(
      [a.enrollmentId, b.enrollmentId].sort(),
    );
  });

  it('只動 pending_payment：已退班（withdrawal）的報名不會被收款拉回 active', async () => {
    const { orgId, classId } = await newOrg();
    const s = await enrollee(orgId, classId, 'withdrawal');
    const inv = await invoice(orgId, s.studentId, [s.enrollmentId]);

    const r = await pay(orgId, inv, 3000);

    expect(r.status === 'done' && r.activated).toEqual([]);
    expect(await status('enrollments', s.enrollmentId)).toBe('withdrawal');
  });

  it('退費不倒轉（Q3）：報名維持 active、申請維持 completed', async () => {
    const { orgId, classId } = await newOrg();
    const s = await enrollee(orgId, classId);
    const inv = await invoice(orgId, s.studentId, [s.enrollmentId]);
    await pay(orgId, inv, 3000);

    const r = await pay(orgId, inv, 3000, 'refund');

    expect(r).toMatchObject({ status: 'done', activated: [], completed: [] });
    expect(await status('enrollments', s.enrollmentId)).toBe('active');
    expect(await status('enrollment_requests', s.requestId)).toBe('completed');
  });

  it('退費超過已收淨額 → refund-exceeds-paid，什麼都沒寫', async () => {
    const { orgId, classId } = await newOrg();
    const s = await enrollee(orgId, classId);
    const inv = await invoice(orgId, s.studentId, [s.enrollmentId]);
    await pay(orgId, inv, 1000);

    expect(await pay(orgId, inv, 1500, 'refund')).toEqual({
      status: 'refund-exceeds-paid',
      net: 1000,
    });
    expect(await q(`SELECT 1 FROM payment_records WHERE invoice_id = $1`, [inv])).toHaveLength(1);
  });

  it('上限算的是淨額（#1034）：收 1,000、已退 400 → 再退 700 擋、退 600 放（剛好退到 0）', async () => {
    const { orgId, classId } = await newOrg();
    const s = await enrollee(orgId, classId);
    const inv = await invoice(orgId, s.studentId, [s.enrollmentId]);
    await pay(orgId, inv, 1000);
    await pay(orgId, inv, 400, 'refund');

    expect(await pay(orgId, inv, 700, 'refund')).toEqual({
      status: 'refund-exceeds-paid',
      net: 600,
    });
    expect((await pay(orgId, inv, 600, 'refund')).status).toBe('done');
  });

  it('兩筆退費同時進來：第二筆等第一筆 COMMIT 才數淨額（淨額不會變負）', async () => {
    const { orgId, classId } = await newOrg();
    const s = await enrollee(orgId, classId);
    const inv = await invoice(orgId, s.studentId, [s.enrollmentId]);
    await pay(orgId, inv, 1000);

    // 第一筆：另一條連線鎖住帳單、寫了退費但還沒 COMMIT。Promise.all 兩筆不保證真的交錯，這樣才確定
    const first = await pool.connect();
    try {
      await first.query('BEGIN');
      await first.query('SELECT 1 FROM invoices WHERE id = $1 FOR UPDATE', [inv]);
      await first.query(
        `INSERT INTO payment_records (org_id, invoice_id, kind, amount, method, recorded_by)
         VALUES ($1, $2, 'refund', 1000, 'cash', $3)`,
        [orgId, inv, userId],
      );
      const second = pay(orgId, inv, 1000, 'refund');
      await new Promise((r) => setTimeout(r, 200));
      await first.query('COMMIT');

      expect(await second).toEqual({ status: 'refund-exceeds-paid', net: 0 });
    } finally {
      first.release();
    }
  });

  it('別 org 的帳單 → not-found；作廢的 → voided；都不寫', async () => {
    const { orgId, classId } = await newOrg();
    const other = await newOrg();
    const s = await enrollee(orgId, classId);
    const inv = await invoice(orgId, s.studentId, [s.enrollmentId]);

    expect(await pay(other.orgId, inv, 1000)).toEqual({ status: 'not-found' });

    await q(`UPDATE invoices SET voided_at = now(), void_reason = 'x' WHERE id = $1`, [inv]);
    expect(await pay(orgId, inv, 1000)).toEqual({ status: 'voided' });
    expect(await q(`SELECT 1 FROM payment_records WHERE invoice_id = $1`, [inv])).toHaveLength(0);
    expect(await status('enrollments', s.enrollmentId)).toBe('pending_payment');
  });

  it('髒資料：明細指到別 org 的報名，不會被轉（報名、申請都守 org_id）', async () => {
    const { orgId, classId } = await newOrg();
    const other = await newOrg();
    const mine = await enrollee(orgId, classId);
    const theirs = await enrollee(other.orgId, other.classId);
    const inv = await invoice(orgId, mine.studentId, [mine.enrollmentId, theirs.enrollmentId]);

    const r = await pay(orgId, inv, 6000);

    expect(r.status === 'done' && r.activated.map((x) => x.id)).toEqual([mine.enrollmentId]);
    expect(r.status === 'done' && r.completed.map((x) => x.id)).toEqual([mine.requestId]);
    expect(await status('enrollments', theirs.enrollmentId)).toBe('pending_payment');
    expect(await status('enrollment_requests', theirs.requestId)).toBe('awaiting_payment');
  });
});
