import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deleteClasses } from '../lib/class-delete';
import { loadClassListStats } from '../lib/class-list-stats';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

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
  async function org(mode?: 'per_session' | 'daily_checkin') {
    const orgId = await one(`INSERT INTO organizations (name) VALUES ($1)`, [
      `c1652-${randomUUID()}`,
    ]);
    orgs.push(orgId);
    // #2544：分校模式明設（不設＝沿用機構預設；新機構預設是 daily_checkin，靠它測不到點名制）
    const campusId = await one(
      `INSERT INTO campuses (org_id, name, attendance_mode) VALUES ($1, 'x', $2)`,
      [orgId, mode ?? null],
    );
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

  // ── #2544「曾發生課堂」：點名制看 completed、日到班看日期且沒停課（lib/class-past-sessions.ts）──
  /** 給班加一堂課：`daysFromToday` 負數＝過去 */
  const addSession = (orgId: string, classId: string, daysFromToday: number, status: string) =>
    q(
      `INSERT INTO sessions (org_id, class_id, session_date, start_time, end_time, assignment_status, status)
       VALUES ($1, $2, CURRENT_DATE + $3::int, '14:00', '15:00', 'unassigned', $4)`,
      [orgId, classId, daysFromToday, status],
    );
  const abortDelete = (orgId: string, classId: string) =>
    deleteClasses(pool, { orgId, ids: [classId], scope: null, onBlocked: 'abort' });

  it('#2544 點名制：過期但沒點名（scheduled）→ 可刪', async () => {
    const a = await org('per_session');
    const { classId } = await a.klass();
    await addSession(a.orgId, classId, -7, 'scheduled');

    expect(await abortDelete(a.orgId, classId)).toMatchObject({
      status: 'done',
      deletedIds: [classId],
      pastSessionIds: [],
    });
    expect(await snapshot(classId)).toEqual([0, 0, 0, 0]);
  });

  it('#2544 點名制：有一堂點過名（completed）→ 不可刪，什麼都沒動', async () => {
    const a = await org('per_session');
    const { classId } = await a.klass();
    await addSession(a.orgId, classId, -7, 'completed');

    expect(await abortDelete(a.orgId, classId)).toMatchObject({
      status: 'done',
      deletedIds: [],
      pastSessionIds: [classId],
    });
    expect(await snapshot(classId)).toEqual([1, 1, 2, 1]);
  });

  it('#2544 日到班：過期（scheduled）→ 不可刪', async () => {
    const a = await org('daily_checkin');
    const { classId } = await a.klass();
    await addSession(a.orgId, classId, -7, 'scheduled');

    expect(await abortDelete(a.orgId, classId)).toMatchObject({
      deletedIds: [],
      pastSessionIds: [classId],
    });
    expect(await snapshot(classId)).toEqual([1, 1, 2, 1]);
  });

  it('#2544 日到班：過期但停課（cancelled）→ 可刪（停課的堂沒發生）', async () => {
    const a = await org('daily_checkin');
    const { classId } = await a.klass();
    await addSession(a.orgId, classId, -7, 'cancelled');

    expect(await abortDelete(a.orgId, classId)).toMatchObject({
      deletedIds: [classId],
      pastSessionIds: [],
    });
    expect(await snapshot(classId)).toEqual([0, 0, 0, 0]);
  });

  it('#2544 「曾發生」那句查詢失敗 → 丟出去（路由回 500），班級與報名一筆都沒少', async () => {
    const a = await org('per_session');
    const { classId } = await a.klass();
    // 獨立的池：被換掉 query 的連線不能還回共用的 pool
    const failing = new Pool({ connectionString: DB });
    const realConnect = failing.connect.bind(failing);
    (failing as unknown as { connect: () => Promise<unknown> }).connect = async () => {
      const client = await realConnect();
      const real = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
      (client as unknown as { query: (...args: unknown[]) => Promise<unknown> }).query = (
        ...args: unknown[]
      ) =>
        typeof args[0] === 'string' && args[0].includes('attendance_mode')
          ? Promise.reject(Object.assign(new Error('boom'), { code: 'XX000' }))
          : real(...args);
      return client;
    };
    try {
      await expect(
        deleteClasses(failing, { orgId: a.orgId, ids: [classId], scope: null, onBlocked: 'abort' }),
      ).rejects.toThrow('boom');
      expect(await snapshot(classId)).toEqual([1, 1, 1, 1]);
    } finally {
      await failing.end();
    }
  });

  // 「分校與機構模式都 NULL」用真資料造不出來：organizations.attendance_mode NOT NULL DEFAULT 'daily_checkin'、
  // classes.campus_id NOT NULL。pastSessionSql 的 coalesce(…, 'daily_checkin') 與 left join 是為了那天被放寬時
  // 仍然當日到班擋刪（不變成 NULL → 可刪）。這條釘住它現在依賴的不變量：哪天放寬了這裡會紅，提醒去補真資料的契約
  it('#2544 模式兩邊都 NULL 的前提：機構模式與班級分校都不可為 NULL（放寬時要補契約）', async () => {
    const cols = await q<{ table_name: string; column_name: string; is_nullable: string }>(
      `SELECT table_name, column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public'
          AND ((table_name = 'organizations' AND column_name = 'attendance_mode')
            OR (table_name = 'classes' AND column_name = 'campus_id'))
        ORDER BY table_name`,
    );
    expect(cols).toEqual([
      { table_name: 'classes', column_name: 'campus_id', is_nullable: 'NO' },
      { table_name: 'organizations', column_name: 'attendance_mode', is_nullable: 'NO' },
    ]);
  });

  it('#2544 列表的 hasPastSessions 跟刪除保護同一個判準', async () => {
    const per = await org('per_session');
    const daily = await org('daily_checkin');
    const overdue = await per.klass();
    const taken = await per.klass();
    const dailyPast = await daily.klass();
    const dailyCancelled = await daily.klass();
    await addSession(per.orgId, overdue.classId, -7, 'scheduled');
    await addSession(per.orgId, taken.classId, -7, 'completed');
    await addSession(daily.orgId, dailyPast.classId, -7, 'scheduled');
    await addSession(daily.orgId, dailyCancelled.classId, -7, 'cancelled');
    const today = getCurrentTaipeiDateString();

    const p = await loadClassListStats(pool, per.orgId, [overdue.classId, taken.classId], today);
    const d = await loadClassListStats(
      pool,
      daily.orgId,
      [dailyPast.classId, dailyCancelled.classId],
      today,
    );
    expect(p.get(overdue.classId)?.hasPastSessions).toBe(false);
    expect(p.get(taken.classId)?.hasPastSessions).toBe(true);
    expect(d.get(dailyPast.classId)?.hasPastSessions).toBe(true);
    expect(d.get(dailyCancelled.classId)?.hasPastSessions).toBe(false);
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
