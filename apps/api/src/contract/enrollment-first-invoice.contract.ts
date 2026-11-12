import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { enrollWithSeatLock } from '../lib/class-seats';
import { approveEnrollmentRequest, type ApproveInput } from '../lib/enrollment-approve';
import {
  directEnrollWithFirstInvoice,
  type FirstInvoiceInput,
} from '../lib/enrollment-first-invoice';
import { recordPayment } from '../lib/record-payment';

/**
 * #2296 SD9：直接報名＋建立繳費單，對**真的** Postgres 跑。
 *
 * 核心那條是「同一學生、同一班、同一天，從直接報名進來跟從家長申請核准進來，第一期**逐欄相同**」——
 * 兩條路共用 `enrollWithFirstInvoice`，相同是結構保證；這裡把它釘死，免得哪天有人在其中一條路
 * 前面多算一步。做法：先核准、把那筆報名作廢（唯一索引不看 void），再直接報名同一個學生進同一班。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

run('直接報名＋建立繳費單對真 Postgres（#2296）', () => {
  const pool = new Pool({ connectionString: DB });
  const orgs: string[] = [];
  let userId = '';

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const one = async (sql: string, params: unknown[]) =>
    (await q<{ id: string }>(`${sql} RETURNING id`, params))[0]!.id;
  const n = async (sql: string, params: unknown[]) =>
    Number((await q<{ n: string }>(sql, params))[0]!.n);

  async function setup(opts: { max?: number } = {}) {
    const orgId = await one(`INSERT INTO organizations (name) VALUES ($1)`, [
      `c2296-${randomUUID()}`,
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
    const period = await one(
      `INSERT INTO fee_templates (org_id, name, billing_mode, amount) VALUES ($1, 'q', 'period', 15300)`,
      [orgId],
    );
    await q(
      `INSERT INTO billing_periods (org_id, name, start_date, end_date) VALUES ($1, 'x', '2026-09-01', '2027-01-31')`,
      [orgId],
    );
    const studentId = await one(
      `INSERT INTO students (org_id, name, grade) VALUES ($1, 'x', 'J1')`,
      [orgId],
    );
    const base: FirstInvoiceInput & { scope: null } = {
      orgId,
      userId,
      studentId,
      classId,
      scope: null,
      billingMode: 'monthly',
      feeTemplateId: monthly,
      agreedAmount: null,
      adjustmentNote: null,
      effectiveFrom: '2026-10-22', // 10 月 31 天，讀 10 天
      effectiveTo: null,
      amount: null,
      amountNote: null,
      issuedAt: '2026-10-21',
      dueDate: null,
      sessionCount: null,
      notes: null,
    };
    return { orgId, campusId, classId, studentId, monthly, pack, period, base };
  }

  const written = async (orgId: string) => [
    await n(`SELECT count(*) n FROM enrollments WHERE org_id = $1`, [orgId]),
    await n(`SELECT count(*) n FROM invoices WHERE org_id = $1`, [orgId]),
    await n(
      `SELECT count(*) n FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.org_id = $1`,
      [orgId],
    ),
    await n(`SELECT count(*) n FROM session_packs WHERE org_id = $1`, [orgId]),
  ];

  /** 一筆報名開出來的第一期，去掉 id／時間戳／帳單號 —— 剩下的每一欄都要一樣 */
  async function firstPeriod(enrollmentId: string) {
    const [enrollment] = await q(
      `SELECT class_id, student_id, status::text, billing_mode::text, fee_template_id, agreed_amount,
              adjustment_note, effective_from::text, effective_to::text
         FROM enrollments WHERE id = $1`,
      [enrollmentId],
    );
    const items = await q(
      `SELECT ii.type::text, ii.amount, ii.period_month::text, ii.billing_period_id, ii.note,
              i.student_id, i.issued_at::text, i.due_date::text
         FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE ii.enrollment_id = $1`,
      [enrollmentId],
    );
    const packs = await q(
      `SELECT purchased_count, purchased_at::text FROM session_packs WHERE enrollment_id = $1`,
      [enrollmentId],
    );
    return { enrollment, items, packs };
  }

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

  type Case = Pick<
    FirstInvoiceInput,
    'effectiveFrom' | 'agreedAmount' | 'adjustmentNote' | 'amount' | 'amountNote' | 'sessionCount'
  > & { readonly mode: FirstInvoiceInput['billingMode'] };
  const cases: Array<[string, Case]> = [
    [
      '月繳月中插班（比例試算＋說明）',
      {
        mode: 'monthly',
        effectiveFrom: '2026-10-22',
        agreedAmount: null,
        adjustmentNote: null,
        amount: null,
        amountNote: null,
        sessionCount: null,
      },
    ],
    [
      '月繳月初（整月，說明 null）',
      {
        mode: 'monthly',
        effectiveFrom: '2026-10-01',
        agreedAmount: null,
        adjustmentNote: null,
        amount: null,
        amountNote: null,
        sessionCount: null,
      },
    ],
    [
      '期繳期中',
      {
        mode: 'period',
        effectiveFrom: '2026-11-15',
        agreedAmount: null,
        adjustmentNote: null,
        amount: null,
        amountNote: null,
        sessionCount: null,
      },
    ],
    [
      '堂數制',
      {
        mode: 'session_pack',
        effectiveFrom: '2026-10-22',
        agreedAmount: null,
        adjustmentNote: null,
        amount: null,
        amountNote: null,
        sessionCount: 12,
      },
    ],
    [
      '議定金額＋行政改首期附原因',
      {
        mode: 'monthly',
        effectiveFrom: '2026-10-22',
        agreedAmount: 6200,
        adjustmentNote: '兄弟檔',
        amount: 1800,
        amountNote: '老生',
        sessionCount: null,
      },
    ],
  ];

  it.each(cases)('契約 1：%s —— 直接報名＋建立與申請核准第一期逐欄相同', async (_, c) => {
    const s = await setup();
    const feeTemplateId = { monthly: s.monthly, period: s.period, session_pack: s.pack }[c.mode];
    const common = { ...c, billingMode: c.mode, feeTemplateId };

    const requestId = await one(
      `INSERT INTO enrollment_requests (org_id, student_id, class_id, status, requested_by)
       VALUES ($1, $2, $3, 'pending', $4)`,
      [s.orgId, s.studentId, s.classId, userId],
    );
    const approveInput: ApproveInput = {
      ...common,
      orgId: s.orgId,
      userId,
      requestId,
      scope: null,
      issuedAt: s.base.issuedAt,
      dueDate: null,
    };
    const approved = await approveEnrollmentRequest(pool, approveInput);
    expect(approved).toMatchObject({ status: 'done' });
    if (approved.status !== 'done') return;
    await q(`UPDATE enrollments SET status = 'void' WHERE id = $1`, [approved.enrollmentId]);

    const direct = await directEnrollWithFirstInvoice(pool, { ...s.base, ...common });
    expect(direct).toMatchObject({
      status: 'done',
      amount: approved.amount,
      dueDate: approved.dueDate,
    });
    if (direct.status !== 'done') return;

    const a = await firstPeriod(approved.enrollmentId);
    const d = await firstPeriod(direct.enrollmentId);
    expect(a.enrollment).toMatchObject({ status: 'void' });
    expect(d.enrollment).toMatchObject({ status: 'pending_payment' });
    expect({ ...d, enrollment: { ...d.enrollment, status: 'x' } }).toEqual({
      ...a,
      enrollment: { ...a.enrollment, status: 'x' },
    });
    expect(d.items).toHaveLength(1);
    expect(d.packs).toHaveLength(c.mode === 'session_pack' ? 1 : 0);
  });

  it('契約 2：不建立 ＝ active、0 張帳單、0 列明細', async () => {
    const s = await setup();
    const r = await enrollWithSeatLock(pool, {
      orgId: s.orgId,
      classId: s.classId,
      rows: [
        {
          studentId: s.studentId,
          status: 'active',
          effectiveFrom: '2026-10-22',
          createdBy: userId,
        },
      ],
    });
    expect(r).toMatchObject({ status: 'done' });
    expect(await written(s.orgId)).toEqual([1, 0, 0, 0]);
    const [e] = await q(`SELECT status::text FROM enrollments WHERE org_id = $1`, [s.orgId]);
    expect(e).toEqual({ status: 'active' });
  });

  it('契約 3：交易中途失敗（報名＋帳單＋明細寫完才炸）→ 什麼都沒寫', async () => {
    const s = await setup();
    // 堂數制沒給堂數：session_packs.purchased_count NOT NULL，是最後一個 INSERT
    await expect(
      directEnrollWithFirstInvoice(pool, {
        ...s.base,
        billingMode: 'session_pack',
        feeTemplateId: s.pack,
        sessionCount: null,
      }),
    ).rejects.toThrow();
    expect(await written(s.orgId)).toEqual([0, 0, 0, 0]);
  });

  it('契約 4：受限管理員 —— 範圍外 not-found 不寫（額滿也一樣，不洩漏名額）；範圍內 done', async () => {
    const s = await setup();
    expect(await directEnrollWithFirstInvoice(pool, { ...s.base, scope: [randomUUID()] })).toEqual({
      status: 'not-found',
    });
    const full = await setup({ max: 0 });
    expect(
      await directEnrollWithFirstInvoice(pool, { ...full.base, scope: [randomUUID()] }),
    ).toEqual({ status: 'not-found' });
    expect(await written(s.orgId)).toEqual([0, 0, 0, 0]);

    expect(
      await directEnrollWithFirstInvoice(pool, { ...s.base, scope: [s.campusId] }),
    ).toMatchObject({ status: 'done' });
    expect(await written(s.orgId)).toEqual([1, 1, 1, 0]);
  });

  it('契約 5：收第一筆款 → 報名轉 active（明細有綁 enrollment_id）', async () => {
    const s = await setup();
    const r = await directEnrollWithFirstInvoice(pool, s.base);
    expect(r).toMatchObject({ status: 'done', amount: 1000 });
    if (r.status !== 'done') return;
    await recordPayment(pool, {
      orgId: s.orgId,
      userId,
      invoiceId: r.invoiceId,
      kind: 'payment',
      amount: 500,
      method: 'cash',
      paidAt: '2026-10-22',
      proofPath: null,
      note: null,
      today: '2026-10-22',
    });
    const [e] = await q(`SELECT status::text FROM enrollments WHERE id = $1`, [r.enrollmentId]);
    expect(e).toEqual({ status: 'active' });
  });

  it('契約 6：生效迄落在首期內 → 首期只算到生效迄（同月結 run）', async () => {
    const s = await setup();
    // 10/22～10/26 = 5/31 天
    const r = await directEnrollWithFirstInvoice(pool, { ...s.base, effectiveTo: '2026-10-26' });
    expect(r).toMatchObject({ status: 'done', amount: 500 });
    if (r.status !== 'done') return;
    const [e] = await q(`SELECT effective_to::text FROM enrollments WHERE id = $1`, [
      r.enrollmentId,
    ]);
    expect(e).toEqual({ effective_to: '2026-10-26' });
  });

  it('建立分支的備註有寫進 enrollments.notes（審核席二讀 #2451）', async () => {
    const s = await setup();
    const r = await directEnrollWithFirstInvoice(pool, { ...s.base, notes: '週三要早退' });
    expect(r).toMatchObject({ status: 'done' });
    if (r.status !== 'done') return;
    const [e] = await q(`SELECT notes FROM enrollments WHERE id = $1`, [r.enrollmentId]);
    expect(e).toEqual({ notes: '週三要早退' });
  });

  it('額滿 → over-quota，什麼都沒寫', async () => {
    const s = await setup({ max: 0 });
    expect(await directEnrollWithFirstInvoice(pool, s.base)).toEqual({
      status: 'over-quota',
      quota: 0,
      currentActive: 0,
    });
    expect(await written(s.orgId)).toEqual([0, 0, 0, 0]);
  });
});
