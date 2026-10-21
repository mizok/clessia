import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  enrollWithSeatLock,
  insertEnrollments,
  lockClassSeats,
  type NewEnrollment,
} from '../lib/class-seats';

/**
 * #1726 Q9：名額的鎖對**真的** Postgres 跑 —— 兩個交易搶最後一位、partial unique 的 ON CONFLICT、
 * org 條件，這些是 SQL 語意，替身驗不出來。自己建資料、測完刪掉，不碰 seed。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

run('班級名額的鎖對真 Postgres（#1726 Q9）', () => {
  // 兩條以上連線才測得出併發
  const pool = new Pool({ connectionString: DB, max: 4 });
  const orgs: string[] = [];

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const one = async (sql: string, params: unknown[]) =>
    (await q<{ id: string }>(`${sql} RETURNING id`, params))[0]!.id;

  /** 一個 org、一個班（上限 `max`）、`n` 個學生 */
  async function setup(max: number, n: number) {
    const orgId = await one(`INSERT INTO organizations (name) VALUES ($1)`, [
      `c1726-${randomUUID()}`,
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
      [orgId, campusId, courseId, max],
    );
    const students: string[] = [];
    for (let i = 0; i < n; i++) {
      students.push(
        await one(`INSERT INTO students (org_id, name, grade) VALUES ($1, 'x', 'J1')`, [orgId]),
      );
    }
    return { orgId, classId, students };
  }

  const row = (studentId: string): NewEnrollment => ({
    studentId,
    status: 'active',
    effectiveFrom: '2026-10-21',
    createdBy: null as unknown as string,
  });
  const seated = async (classId: string) =>
    Number(
      (
        await q<{ n: string }>(
          `SELECT count(*) n FROM enrollments WHERE class_id = $1 AND status IN ('active','pending_payment')`,
          [classId],
        )
      )[0]!.n,
    );

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });
  afterAll(async () => {
    if (orgs.length) {
      for (const t of ['enrollments', 'classes', 'courses', 'students', 'subjects', 'campuses']) {
        await pool.query(`DELETE FROM ${t} WHERE org_id = ANY($1)`, [orgs]);
      }
      await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [orgs]);
    }
    await pool.end();
  });

  it('兩個交易搶最後一位：A 拿著鎖時 B 要等；A 寫進去後 B 數到額滿 → over-quota', async () => {
    const { orgId, classId, students } = await setup(1, 2);
    const a = await pool.connect();
    try {
      await a.query('BEGIN');
      expect(await lockClassSeats(a, { orgId, classId, studentIds: [students[0]!] })).toMatchObject(
        {
          status: 'ok',
        },
      );
      // A 還沒 COMMIT：B 必須卡在鎖上，不能先數完
      let bDone = false;
      const b = enrollWithSeatLock(pool, { orgId, classId, rows: [row(students[1]!)] }).then(
        (r) => ((bDone = true), r),
      );
      await new Promise((r) => setTimeout(r, 200));
      expect(bDone).toBe(false);

      await insertEnrollments(a, { orgId, classId, rows: [row(students[0]!)] });
      await a.query('COMMIT');
      expect(await b).toMatchObject({ status: 'over-quota', currentActive: 1 });
    } finally {
      a.release();
    }
    expect(await seated(classId)).toBe(1);
  });

  it('已在班上的跳過、不中止交易，其餘照寫', async () => {
    const { orgId, classId, students } = await setup(1000, 2);
    await enrollWithSeatLock(pool, { orgId, classId, rows: [row(students[0]!)] });
    const r = await enrollWithSeatLock(pool, { orgId, classId, rows: students.map(row) });
    expect(r).toMatchObject({ status: 'done' });
    expect(r.status === 'done' && r.inserted.map((x) => x.studentId)).toEqual([students[1]]);
    expect(await seated(classId)).toBe(2);
  });

  it('已在班上的不重複算名額：上限 2、已有 1 人，再送同一人＋新一人 → 寫得進', async () => {
    const { orgId, classId, students } = await setup(2, 2);
    await enrollWithSeatLock(pool, { orgId, classId, rows: [row(students[0]!)] });
    const r = await enrollWithSeatLock(pool, { orgId, classId, rows: students.map(row) });
    expect(r).toMatchObject({ status: 'done' });
    expect(await seated(classId)).toBe(2);
  });

  it('超過上限整批不寫', async () => {
    const { orgId, classId, students } = await setup(1, 2);
    const r = await enrollWithSeatLock(pool, { orgId, classId, rows: students.map(row) });
    expect(r).toMatchObject({ status: 'over-quota', quota: 1, currentActive: 0, adding: 2 });
    expect(await seated(classId)).toBe(0);
  });

  it('別 org 的班 → not-found，什麼都沒寫（c1）', async () => {
    const a = await setup(1000, 1);
    const b = await setup(1000, 0);
    const r = await enrollWithSeatLock(pool, {
      orgId: b.orgId,
      classId: a.classId,
      rows: [row(a.students[0]!)],
    });
    expect(r).toEqual({ status: 'not-found' });
    expect(await seated(a.classId)).toBe(0);
  });
});
