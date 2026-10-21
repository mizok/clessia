import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { approveEnrollmentRequest, type ApproveInput } from '../lib/enrollment-approve';

/**
 * #1726：核准家長報名申請的交易對**真的** Postgres 跑 —— 全有或全無、名額、範圍、
 * 帳單明細的週期欄、invoice_no trigger、堂數包，這些是 SQL 語意，替身驗不出來。
 * 自己建資料、測完刪掉，不碰 seed（只借一個既有 ba_user 當申請人：c2 不寫 ba_*）。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

run('核准家長報名申請的交易對真 Postgres（#1726）', () => {
  const pool = new Pool({ connectionString: DB });
  const orgs: string[] = [];
  let userId = '';

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const one = async (sql: string, params: unknown[]) =>
    (await q<{ id: string }>(`${sql} RETURNING id`, params))[0]!.id;
  const n = async (sql: string, params: unknown[]) =>
    Number((await q<{ n: string }>(sql, params))[0]!.n);

  /** 一個 org：分校、班（上限 `max`）、月繳／堂數制價目表各一、一個學生的申請 */
  async function setup(opts: { max?: number; status?: string } = {}) {
    const orgId = await one(`INSERT INTO organizations (name) VALUES ($1)`, [
      `c1726a-${randomUUID()}`,
    ]);
    orgs.push(orgId);
    const campusId = await one(`INSERT INTO campuses (org_id, name) VALUES ($1, 'x')`, [orgId]);
    const subjectId = await one(`INSERT INTO subjects (org_id, name) VALUES ($1, 'x')`, [orgId]);
    const courseId = await one(
      `INSERT INTO courses (org_id, campus_id, subject_id, name) VALUES ($1, $2, $3, 'x')`,
      [orgId, campusId, subjectId],
    );
    const classId = await one(
      `INSERT INTO classes (org_id, campus_id, course_id, name, max_students) VALUES ($1, $2, $3, 'x', $4)`,
      [orgId, campusId, courseId, opts.max ?? 20],
    );
    const monthly = await one(
      `INSERT INTO fee_templates (org_id, name, billing_mode, amount) VALUES ($1, 'm', 'monthly', 3100)`,
      [orgId],
    );
    const pack = await one(
      `INSERT INTO fee_templates (org_id, name, billing_mode, amount) VALUES ($1, 'p', 'session_pack', 6000)`,
      [orgId],
    );
    const studentId = await one(
      `INSERT INTO students (org_id, name, grade) VALUES ($1, 'x', 'J1')`,
      [orgId],
    );
    const requestId = await one(
      `INSERT INTO enrollment_requests (org_id, student_id, class_id, status, requested_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [orgId, studentId, classId, opts.status ?? 'pending', userId],
    );
    const base: ApproveInput = {
      orgId,
      userId,
      requestId,
      scope: null,
      billingMode: 'monthly',
      feeTemplateId: monthly,
      agreedAmount: null,
      adjustmentNote: null,
      effectiveFrom: '2026-10-22', // 10 月 31 天，讀 10 天
      amount: null,
      amountNote: null,
      issuedAt: '2026-10-21',
      dueDate: null,
      sessionCount: null,
    };
    return { orgId, campusId, courseId, classId, studentId, requestId, monthly, pack, base };
  }

  /** 這個 org 寫了多少：報名、帳單、明細、堂數包 */
  const written = async (orgId: string) => [
    await n(`SELECT count(*) n FROM enrollments WHERE org_id = $1`, [orgId]),
    await n(`SELECT count(*) n FROM invoices WHERE org_id = $1`, [orgId]),
    await n(
      `SELECT count(*) n FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.org_id = $1`,
      [orgId],
    ),
    await n(`SELECT count(*) n FROM session_packs WHERE org_id = $1`, [orgId]),
  ];
  const requestStatus = async (id: string) =>
    (
      await q<{ status: string; enrollment_id: string | null }>(
        `SELECT status::text, enrollment_id FROM enrollment_requests WHERE id = $1`,
        [id],
      )
    )[0]!;

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
          'session_packs',
          'invoices',
          'enrollment_requests',
          'enrollments',
          'fee_templates',
          'billing_periods',
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

  it('月繳：建 pending_payment 報名、開帳單＋一列學費（填 period_month、比例試算）、申請轉 awaiting_payment', async () => {
    const s = await setup();
    const r = await approveEnrollmentRequest(pool, s.base);
    expect(r).toMatchObject({ status: 'done', amount: 1000, dueDate: '2026-11-04' });
    if (r.status !== 'done') return;
    expect(r.invoiceNo).toBeTruthy();

    expect(await written(s.orgId)).toEqual([1, 1, 1, 0]);
    const [e] = await q<{ status: string; fee_template_id: string }>(
      `SELECT status::text, fee_template_id FROM enrollments WHERE id = $1`,
      [r.enrollmentId],
    );
    expect(e).toEqual({ status: 'pending_payment', fee_template_id: s.monthly });
    const [item] = await q<{ type: string; amount: string; period_month: string; note: string }>(
      `SELECT type::text, amount, period_month::text, note FROM invoice_items WHERE invoice_id = $1`,
      [r.invoiceId],
    );
    expect(item).toMatchObject({ type: 'tuition', amount: '1000', period_month: '2026-10-01' });
    expect(item!.note).toContain('10/31');
    expect(await requestStatus(s.requestId)).toEqual({
      status: 'awaiting_payment',
      enrollment_id: r.enrollmentId,
    });
  });

  it('候補可以直接核准', async () => {
    const s = await setup({ status: 'waitlist' });
    expect(await approveEnrollmentRequest(pool, s.base)).toMatchObject({ status: 'done' });
  });

  it('額滿 → class-full，什麼都沒寫，申請仍是待審核', async () => {
    const s = await setup({ max: 1 });
    const other = await one(`INSERT INTO students (org_id, name, grade) VALUES ($1, 'y', 'J1')`, [
      s.orgId,
    ]);
    await q(`INSERT INTO enrollments (org_id, class_id, student_id) VALUES ($1, $2, $3)`, [
      s.orgId,
      s.classId,
      other,
    ]);
    expect(await approveEnrollmentRequest(pool, s.base)).toEqual({ status: 'class-full' });
    expect(await written(s.orgId)).toEqual([1, 0, 0, 0]);
    expect((await requestStatus(s.requestId)).status).toBe('pending');
  });

  it('已拒絕的申請 → not-approvable', async () => {
    const s = await setup({ status: 'rejected' });
    expect(await approveEnrollmentRequest(pool, s.base)).toEqual({
      status: 'not-approvable',
      current: 'rejected',
    });
    expect(await written(s.orgId)).toEqual([0, 0, 0, 0]);
  });

  it('核准兩次：第二次 not-approvable，帳單不會多一張', async () => {
    const s = await setup();
    await approveEnrollmentRequest(pool, s.base);
    expect(await approveEnrollmentRequest(pool, s.base)).toMatchObject({
      status: 'not-approvable',
    });
    expect(await written(s.orgId)).toEqual([1, 1, 1, 0]);
  });

  it('學生已在班上 → already-enrolled，整筆回滾', async () => {
    const s = await setup();
    await q(`INSERT INTO enrollments (org_id, class_id, student_id) VALUES ($1, $2, $3)`, [
      s.orgId,
      s.classId,
      s.studentId,
    ]);
    expect(await approveEnrollmentRequest(pool, s.base)).toEqual({ status: 'already-enrolled' });
    expect(await written(s.orgId)).toEqual([1, 0, 0, 0]);
    expect((await requestStatus(s.requestId)).status).toBe('pending');
  });

  it('別 org 的申請 → not-found（c1）', async () => {
    const a = await setup();
    const b = await setup();
    expect(await approveEnrollmentRequest(pool, { ...a.base, orgId: b.orgId })).toEqual({
      status: 'not-found',
    });
    expect(await written(a.orgId)).toEqual([0, 0, 0, 0]);
  });

  it('班不在分校範圍 → not-found（額滿也一樣，不洩漏名額）', async () => {
    const s = await setup({ max: 0 });
    expect(await approveEnrollmentRequest(pool, { ...s.base, scope: [randomUUID()] })).toEqual({
      status: 'not-found',
    });
  });

  it('價目表模式不符 → invalid-fee-template', async () => {
    const s = await setup();
    expect(await approveEnrollmentRequest(pool, { ...s.base, feeTemplateId: s.pack })).toEqual({
      status: 'invalid-fee-template',
    });
  });

  it('別 org 的價目表 → invalid-fee-template（c1）', async () => {
    const a = await setup();
    const b = await setup();
    expect(await approveEnrollmentRequest(pool, { ...a.base, feeTemplateId: b.monthly })).toEqual({
      status: 'invalid-fee-template',
    });
  });

  it('改了首期金額沒寫原因 → amount-note-required；寫了原因就照改的開', async () => {
    const s = await setup();
    expect(await approveEnrollmentRequest(pool, { ...s.base, amount: 900 })).toEqual({
      status: 'amount-note-required',
      suggested: 1000,
    });
    const r = await approveEnrollmentRequest(pool, { ...s.base, amount: 900, amountNote: '老生' });
    expect(r).toMatchObject({ status: 'done', amount: 900 });
    if (r.status !== 'done') return;
    const [item] = await q<{ note: string }>(
      `SELECT note FROM invoice_items WHERE invoice_id = $1`,
      [r.invoiceId],
    );
    expect(item!.note).toBe('老生');
  });

  it('期繳：沒有涵蓋生效起的期 → no-billing-period；有就填 billing_period_id', async () => {
    const s = await setup();
    const periodTpl = await one(
      `INSERT INTO fee_templates (org_id, name, billing_mode, amount) VALUES ($1, 'q', 'period', 20000)`,
      [s.orgId],
    );
    const input = { ...s.base, billingMode: 'period' as const, feeTemplateId: periodTpl };
    expect(await approveEnrollmentRequest(pool, input)).toEqual({ status: 'no-billing-period' });

    const periodId = await one(
      `INSERT INTO billing_periods (org_id, name, start_date, end_date) VALUES ($1, 'x', '2026-09-01', '2027-01-31')`,
      [s.orgId],
    );
    const r = await approveEnrollmentRequest(pool, input);
    expect(r).toMatchObject({ status: 'done' });
    if (r.status !== 'done') return;
    const [item] = await q<{ billing_period_id: string; period_month: string | null }>(
      `SELECT billing_period_id, period_month FROM invoice_items WHERE invoice_id = $1`,
      [r.invoiceId],
    );
    expect(item).toEqual({ billing_period_id: periodId, period_month: null });
  });

  it('堂數制：不按比例、明細 type session_pack、多一列 session_packs 連回明細', async () => {
    const s = await setup();
    const r = await approveEnrollmentRequest(pool, {
      ...s.base,
      billingMode: 'session_pack',
      feeTemplateId: s.pack,
      sessionCount: 12,
    });
    expect(r).toMatchObject({ status: 'done', amount: 6000 });
    if (r.status !== 'done') return;
    expect(await written(s.orgId)).toEqual([1, 1, 1, 1]);
    const [p] = await q<{ purchased_count: number; ok: boolean }>(
      `SELECT sp.purchased_count, sp.invoice_item_id = ii.id AS ok
         FROM session_packs sp JOIN invoice_items ii ON ii.enrollment_id = sp.enrollment_id
        WHERE sp.enrollment_id = $1`,
      [r.enrollmentId],
    );
    expect(p).toEqual({ purchased_count: 12, ok: true });
  });
});
