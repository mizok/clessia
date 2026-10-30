import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { SCORE_EXPORT_SQL } from '../routes/scores';

/**
 * #1100 #40：成績匯出的 SQL 對**真的** Postgres 跑（保留類 —— 匯出是把資料帶出系統）。
 * 替身不跑 SQL；org 條件與學生篩選是這條 SQL 的語意，只有真 DB 驗得了（#1922 二讀：字串斷言是假的）。
 *
 * 兩個 org 各有考試與成績，再刻意造兩筆**跨 org 的髒資料**（A 的考試掛到 B 的班、B 的報名指到 A 的班）——
 * 正常流程寫不出來，但 SQL 的 org 條件就是要在那種資料下也不漏。全部在一個交易裡，測完 ROLLBACK。
 */
const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

run('成績匯出的 SQL 對真 Postgres（#1100 #40）', () => {
  const pool = new Pool({ connectionString: DB });
  afterAll(() => pool.end());

  async function inTx(fn: (db: PoolClient) => Promise<void>) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await fn(db);
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  }

  async function fixture(db: PoolClient) {
    const one = async (sql: string, params: unknown[]) =>
      (await db.query<{ id: string }>(`${sql} RETURNING id`, params)).rows[0]!.id;
    const org = async (tag: string, className: string) => {
      const orgId = await one('INSERT INTO organizations (name) VALUES ($1)', [
        `c40-${randomUUID()}`,
      ]);
      const subjectId = await one('INSERT INTO subjects (org_id, name) VALUES ($1, $2)', [
        orgId,
        `${tag}科`,
      ]);
      const campusId = await one('INSERT INTO campuses (org_id, name) VALUES ($1, $2)', [
        orgId,
        randomUUID(),
      ]);
      const courseId = await one(
        'INSERT INTO courses (org_id, campus_id, subject_id, name) VALUES ($1, $2, $3, $4)',
        [orgId, campusId, subjectId, `${tag}課程`],
      );
      const classId = await one(
        'INSERT INTO classes (org_id, campus_id, course_id, name) VALUES ($1, $2, $3, $4)',
        [orgId, campusId, courseId, className],
      );
      const student = (name: string) =>
        one(`INSERT INTO students (org_id, name, grade) VALUES ($1, $2, 'J1')`, [orgId, name]);
      const examId = await one(
        'INSERT INTO academy_exams (org_id, name, exam_date) VALUES ($1, $2, $3)',
        [orgId, `${tag}校內考`, '2026-10-01'],
      );
      await db.query('INSERT INTO academy_exam_classes (exam_id, class_id) VALUES ($1, $2)', [
        examId,
        classId,
      ]);
      const schoolId = await one('INSERT INTO schools (org_id, name) VALUES ($1, $2)', [
        orgId,
        randomUUID(),
      ]);
      const schoolExamId = await one(
        `INSERT INTO school_exams (org_id, academic_year, semester, exam_type, label, school_id)
         VALUES ($1, 114, 1, 'term_exam', $2, $3)`,
        [orgId, `${tag}段考`, schoolId],
      );
      const score = async (studentId: string) => {
        await db.query(
          `INSERT INTO academy_scores (exam_id, student_id, score, status) VALUES ($1, $2, 80, 'scored')`,
          [examId, studentId],
        );
        await db.query(
          `INSERT INTO school_scores (school_exam_id, student_id, subject_id, score, status) VALUES ($1, $2, $3, 90, 'scored')`,
          [schoolExamId, studentId, subjectId],
        );
      };
      const enroll = (studentId: string, cls = classId, enrollOrg = orgId) =>
        db.query('INSERT INTO enrollments (org_id, class_id, student_id) VALUES ($1, $2, $3)', [
          enrollOrg,
          cls,
          studentId,
        ]);
      return { orgId, classId, examId, student, score, enroll };
    };

    // 班名刻意讓 B 的班排在 A 的前面：org 條件一拿掉，LATERAL 的 ORDER BY name 就會挑到 B 的班
    const A = await org('A', 'Z-A 的班');
    const B = await org('B', 'A-B 的班');
    const a1 = await A.student('甲');
    const a2 = await A.student('乙'); // 沒有報名 A 的班
    const b1 = await B.student('丙');
    await A.enroll(a1);
    await B.enroll(b1);
    for (const s of [a1, a2]) await A.score(s);
    await B.score(b1);
    // 跨 org 髒資料，每一筆只能被一個條件擋住（才分得出哪個條件被拿掉）：
    // - A 的考試也掛到 B 的班，a1 有一筆 org=A 的報名指到 B 的班 → 只有 c.org_id 擋得住
    // - a2 有一筆 org=B 的報名指到 A 的班 → 只有 en.org_id 擋得住
    await db.query('INSERT INTO academy_exam_classes (exam_id, class_id) VALUES ($1, $2)', [
      A.examId,
      B.classId,
    ]);
    await A.enroll(a1, B.classId, A.orgId);
    await A.enroll(a2, A.classId, B.orgId);
    return { A, B, a1, a2, b1 };
  }

  type Row = {
    student_name: string;
    class_name: string | null;
    exam_name: string;
    course_name: string | null;
  };
  const exportRows = async (db: PoolClient, orgId: string, ids: string[] | null) =>
    (await db.query<Row>(SCORE_EXPORT_SQL, [orgId, ids, 100, null])).rows;
  const names = (rows: Row[]) => rows.map((r) => `${r.student_name}/${r.exam_name}`).sort();

  it('只撈本 org 的成績（校內考與段考都是）', () =>
    inTx(async (db) => {
      const { A } = await fixture(db);
      expect(names(await exportRows(db, A.orgId, null))).toEqual(
        ['甲/A校內考', '甲/A段考', '乙/A校內考', '乙/A段考'].sort(),
      );
    }));

  it('學生篩選：只撈帶來的學生（校內考與段考都是）；帶別 org 的學生撈不到', () =>
    inTx(async (db) => {
      const { A, a1, b1 } = await fixture(db);
      expect(names(await exportRows(db, A.orgId, [a1]))).toEqual(['甲/A校內考', '甲/A段考']);
      expect(await exportRows(db, A.orgId, [b1])).toEqual([]);
    }));

  it('開課班／課程只取本 org 的班與本 org 的報名（跨 org 的髒資料不會被挑中）', () =>
    inTx(async (db) => {
      const { A } = await fixture(db);
      const academy = (await exportRows(db, A.orgId, null)).filter(
        (r) => r.exam_name === 'A校內考',
      );
      const byName = Object.fromEntries(
        academy.map((r) => [r.student_name, [r.class_name, r.course_name]]),
      );
      expect(byName).toEqual({ 甲: ['Z-A 的班', 'A課程'], 乙: [null, null] });
    }));
});
