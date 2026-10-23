import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deleteClasses } from '../lib/class-delete';

/**
 * #1652：刪班級的交易對**真的** Postgres 跑 —— org 條件、分校範圍、守門、FK 回滾，
 * 這些是 SQL 語意，替身驗不出來。
 *
 * 自己建兩個 org 的資料、測完逐張刪掉（見 afterAll），不碰 seed。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

run('刪班級交易對真 Postgres（#1652）', () => {
  const pool = new Pool({ connectionString: DB });
  const orgs: string[] = [];

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const one = async (sql: string, params: unknown[]) =>
    (await q<{ id: string }>(`${sql} RETURNING id`, params))[0]!.id;
  const count = async (table: string, col: string, id: string) =>
    Number(
      (await q<{ n: string }>(`SELECT count(*) n FROM ${table} WHERE ${col} = $1`, [id]))[0]!.n,
    );

  /** 一個 org：一個分校、一門課、一個學生；`klass()` 開一個班（含一筆報名、一個排課、一堂未來課） */
  async function org() {
    const orgId = await one(`INSERT INTO organizations (name) VALUES ($1)`, [
      `c1652-${randomUUID()}`,
    ]);
    orgs.push(orgId);
    const campusId = await one(`INSERT INTO campuses (org_id, name) VALUES ($1, 'x')`, [orgId]);
    const subjectId = await one(`INSERT INTO subjects (org_id, name) VALUES ($1, 'x')`, [orgId]);
    const courseId = await one(
      `INSERT INTO courses (org_id, campus_id, subject_id, name) VALUES ($1, $2, $3, 'x')`,
      [orgId, campusId, subjectId],
    );
    const studentId = await one(
      `INSERT INTO students (org_id, name, grade) VALUES ($1, 'x', 'J1')`,
      [orgId],
    );
    const klass = async () => {
      const classId = await one(
        `INSERT INTO classes (org_id, campus_id, course_id, name) VALUES ($1, $2, $3, $4)`,
        [orgId, campusId, courseId, randomUUID()],
      );
      const enrollmentId = await one(
        `INSERT INTO enrollments (org_id, class_id, student_id) VALUES ($1, $2, $3)`,
        [orgId, classId, studentId],
      );
      await q(
        `INSERT INTO schedules (class_id, weekday, start_time, end_time) VALUES ($1, 1, '10:00', '11:00')`,
        [classId],
      );
      await q(
        `INSERT INTO sessions (org_id, class_id, session_date, start_time, end_time, assignment_status)
         VALUES ($1, $2, CURRENT_DATE + 30, '10:00', '11:00', 'unassigned')`,
        [orgId, classId],
      );
      return { classId, enrollmentId };
    };
    return { orgId, campusId, studentId, klass };
  }

  /** 班級、報名、課堂、排課 的筆數 —— 「什麼都沒動」就是前後一樣 */
  const snapshot = async (classId: string) => [
    await count('classes', 'id', classId),
    await count('enrollments', 'class_id', classId),
    await count('sessions', 'class_id', classId),
    await count('schedules', 'class_id', classId),
  ];

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });
  afterAll(async () => {
    if (orgs.length) {
      // 已作廢帳單的明細刪不掉（guard_voided_invoice_children），學生等對 org 是 RESTRICT ——
      // 子表在 replica 模式（觸發器與 FK 動作都不跑）裡逐張刪，org 本身回正常模式刪，讓其餘 CASCADE 照跑
      const db = await pool.connect(); // BEGIN／SET LOCAL／COMMIT 要在同一條連線上
      try {
        await db.query('BEGIN');
        await db.query('SET LOCAL session_replication_role = replica');
        await db.query(
          'DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE org_id = ANY($1))',
          [orgs],
        );
        await db.query(
          'DELETE FROM schedules WHERE class_id IN (SELECT id FROM classes WHERE org_id = ANY($1))',
          [orgs],
        );
        for (const t of [
          'invoices',
          'session_packs',
          'sessions',
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

  it('乾淨的班：班級、報名、課堂、排課全刪', async () => {
    const a = await org();
    const { classId } = await a.klass();
    expect(await snapshot(classId)).toEqual([1, 1, 1, 1]);

    const r = await deleteClasses(pool, {
      orgId: a.orgId,
      ids: [classId],
      scope: null,
      onBlocked: 'abort',
    });
    expect(r).toMatchObject({ status: 'done', deletedIds: [classId] });
    expect(await snapshot(classId)).toEqual([0, 0, 0, 0]);
  });

  it('別 org 的班 → not-found，對方什麼都沒變（c1）', async () => {
    const a = await org();
    const b = await org();
    const { classId } = await b.klass();

    const r = await deleteClasses(pool, {
      orgId: a.orgId,
      ids: [classId],
      scope: null,
      onBlocked: 'abort',
    });
    expect(r).toEqual({ status: 'not-found' });
    expect(await snapshot(classId)).toEqual([1, 1, 1, 1]);
  });

  it('不在分校範圍 → not-found，什麼都沒變', async () => {
    const a = await org();
    const { classId } = await a.klass();
    const r = await deleteClasses(pool, {
      orgId: a.orgId,
      ids: [classId],
      scope: [randomUUID()],
      onBlocked: 'abort',
    });
    expect(r).toEqual({ status: 'not-found' });
    expect(await snapshot(classId)).toEqual([1, 1, 1, 1]);
  });

  it('批次：一班有帳單明細（已作廢的單）→ 整批不動，標出那一班', async () => {
    const a = await org();
    const clean = await a.klass();
    const billed = await a.klass();
    const invoiceId = await one(`INSERT INTO invoices (org_id, student_id) VALUES ($1, $2)`, [
      a.orgId,
      a.studentId,
    ]);
    await q(
      `INSERT INTO invoice_items (invoice_id, type, enrollment_id, amount) VALUES ($1, 'tuition', $2, 100)`,
      [invoiceId, billed.enrollmentId],
    );
    await q(`UPDATE invoices SET voided_at = now(), void_reason = 'x' WHERE id = $1`, [invoiceId]);

    const r = await deleteClasses(pool, {
      orgId: a.orgId,
      ids: [clean.classId, billed.classId],
      scope: null,
      onBlocked: 'skip',
    });
    expect(r).toEqual({ status: 'has-invoice-items', classIds: [billed.classId] });
    expect(await snapshot(clean.classId)).toEqual([1, 1, 1, 1]);
    expect(await snapshot(billed.classId)).toEqual([1, 1, 1, 1]);
  });

  it('批次：有過去課堂的班略過、有堂數包的班略過，其餘照刪', async () => {
    const a = await org();
    const past = await a.klass();
    const packed = await a.klass();
    const clean = await a.klass();
    await q(
      `INSERT INTO sessions (org_id, class_id, session_date, start_time, end_time, assignment_status)
       VALUES ($1, $2, CURRENT_DATE - 1, '10:00', '11:00', 'unassigned')`,
      [a.orgId, past.classId],
    );
    await q(
      `INSERT INTO session_packs (org_id, enrollment_id, purchased_count) VALUES ($1, $2, 10)`,
      [a.orgId, packed.enrollmentId],
    );

    const r = await deleteClasses(pool, {
      orgId: a.orgId,
      ids: [past.classId, packed.classId, clean.classId],
      scope: null,
      onBlocked: 'skip',
    });
    expect(r).toMatchObject({
      status: 'done',
      deletedIds: [clean.classId],
      pastSessionIds: [past.classId],
      sessionPackIds: [packed.classId],
    });
    expect((await snapshot(past.classId))[0]).toBe(1);
    expect(await snapshot(packed.classId)).toEqual([1, 1, 1, 1]);
    expect(await snapshot(clean.classId)).toEqual([0, 0, 0, 0]);
  });

  /**
   * 丟掉模擬用的 FK 表，**鎖的順序固定成「先 enrollments、後模擬表」**（#2001）。
   *
   * 直接 `DROP TABLE` 時 Postgres 先拿模擬表的 AccessExclusive、再去拿 enrollments 的（要拆它身上的 RI trigger）。
   * 同時在跑的別支契約若正在刪報名，是反過來：先鎖 enrollments、FK 檢查再去模擬表拿 RowShare ——
   * 兩邊互等就是 CI 那次的 40P01（`Process A waits for AccessExclusiveLock on enrollments; blocked by B.
   * Process B waits for RowShareLock on <模擬表>; blocked by A`）。先在同一筆交易裡鎖 enrollments，就跟大家同一個順序。
   * 不用重試掩蓋。
   */
  const dropBlockingTable = async (name: string) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE enrollments IN ACCESS EXCLUSIVE MODE');
      await client.query(`DROP TABLE ${name}`);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  };

  it('FK 擋下（模擬一條指向報名的 RESTRICT）→ in-use，整筆回滾，報名一筆都沒少', async () => {
    const a = await org();
    const { classId, enrollmentId } = await a.klass();
    // 現行 schema 裡沒有任何會擋這條鏈的 FK（invoice_items 是 SET NULL）—— 開一張真表模擬將來的那一條。
    // temp table 不能 FK 到永久表，所以是真表，測完就丟。
    const block = `c1652_block_${randomUUID().replace(/-/g, '')}`;
    await q(
      `CREATE TABLE ${block} (enrollment_id uuid REFERENCES enrollments(id) ON DELETE RESTRICT)`,
    );
    try {
      await q(`INSERT INTO ${block} VALUES ($1)`, [enrollmentId]);
      const r = await deleteClasses(pool, {
        orgId: a.orgId,
        ids: [classId],
        scope: null,
        onBlocked: 'abort',
      });
      expect(r).toEqual({ status: 'in-use' });
      expect(await snapshot(classId)).toEqual([1, 1, 1, 1]);
    } finally {
      await dropBlockingTable(block);
    }
  });
});
