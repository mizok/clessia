import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { writeExamScores, type WriteExamScoresInput } from '../lib/exam-scores-write';

/**
 * #1931：考試完成後仍可修改，成績與「舊值→新值」的操作紀錄同一個交易 —— 對**真的** Postgres 跑。
 * ON CONFLICT 不碰 created_by、三段鍵的刪除、稽核寫失敗整筆回滾，這些是 SQL 語意，替身驗不出來。
 * 自己建資料、測完刪掉，不碰 seed（只借一個既有 ba_user 當登錄人：c2 不寫 ba_*）。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

run('成績寫入與稽核同一個交易（#1931）', () => {
  const pool = new Pool({ connectionString: DB });
  const orgs: string[] = [];
  let userId = '';
  let otherUserId = '';

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const one = async (sql: string, params: unknown[]) =>
    (await q<{ id: string }>(`${sql} RETURNING id`, params))[0]!.id;

  async function newOrg() {
    const orgId = await one(`INSERT INTO organizations (name) VALUES ($1)`, [
      `c1931-${randomUUID()}`,
    ]);
    orgs.push(orgId);
    const studentId = await one(
      `INSERT INTO students (org_id, name, grade) VALUES ($1, '王小明', 'J2')`,
      [orgId],
    );
    return { orgId, studentId };
  }

  async function academyExam(orgId: string, status: 'active' | 'closed') {
    return one(
      `INSERT INTO academy_exams (org_id, name, exam_date, status) VALUES ($1, '第三次小考', '2026-10-20', $2)`,
      [orgId, status],
    );
  }

  const base = (
    orgId: string,
    examId: string,
    over: Partial<WriteExamScoresInput> = {},
  ): WriteExamScoresInput => ({
    kind: 'academy',
    orgId,
    userId,
    userName: '測試行政',
    examId,
    examName: '第三次小考',
    toUpsert: [],
    toDelete: [],
    ...over,
  });

  const scores = (examId: string) =>
    q<{ student_id: string; score: string | null; status: string; created_by: string | null }>(
      `SELECT student_id, score, status::text AS status, created_by FROM academy_scores WHERE exam_id = $1`,
      [examId],
    );
  const audits = (orgId: string) =>
    q<{ action: string; details: Record<string, unknown>; user_name: string | null }>(
      `SELECT action, details, user_name FROM audit_logs WHERE org_id = $1 ORDER BY created_at, action`,
      [orgId],
    );

  beforeAll(async () => {
    const users = await q<{ id: string }>('SELECT id FROM ba_user ORDER BY id LIMIT 2');
    userId = users[0]!.id;
    otherUserId = users[1]?.id ?? users[0]!.id;
  });
  afterAll(async () => {
    if (orgs.length) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query('SET LOCAL session_replication_role = replica');
        await db.query(
          'DELETE FROM academy_scores WHERE exam_id IN (SELECT id FROM academy_exams WHERE org_id = ANY($1))',
          [orgs],
        );
        await db.query(
          'DELETE FROM school_scores WHERE school_exam_id IN (SELECT id FROM school_exams WHERE org_id = ANY($1))',
          [orgs],
        );
        for (const t of [
          'audit_logs',
          'academy_exams',
          'school_exams',
          'schools',
          'subjects',
          'students',
        ]) {
          await db.query(`DELETE FROM ${t} WHERE org_id::text = ANY($1)`, [orgs]);
        }
        await db.query('DELETE FROM organizations WHERE id = ANY($1)', [orgs]);
        await db.query('COMMIT');
      } finally {
        db.release();
      }
    }
    await pool.end();
  });

  it('完成的考試照樣能改；紀錄有舊值→新值、examClosed、登錄人名字', async () => {
    const { orgId, studentId } = await newOrg();
    const examId = await academyExam(orgId, 'closed');
    await q(
      `INSERT INTO academy_scores (exam_id, student_id, score, status, created_by) VALUES ($1, $2, 70, 'scored', $3)`,
      [examId, studentId, userId],
    );

    const r = await writeExamScores(
      pool,
      base(orgId, examId, {
        toUpsert: [{ studentId, score: 85, status: 'scored', notes: null }],
      }),
    );

    expect(r).toMatchObject({ status: 'done', examClosed: true });
    expect(Number((await scores(examId))[0]!.score)).toBe(85);
    const [log] = await audits(orgId);
    expect(log!.action).toBe('academy_exam.scores.upsert');
    expect(log!.user_name).toBe('測試行政');
    expect(log!.details).toMatchObject({
      affected: 1,
      examClosed: true,
      changes: [
        {
          studentId,
          studentName: '王小明',
          before: { score: 70, status: 'scored', notes: null },
          after: { score: 85, status: 'scored', notes: null },
        },
      ],
    });
  });

  it('改分數不覆蓋 created_by：登錄者維持第一次登錄的人，改的人只進紀錄（Q2）', async () => {
    const { orgId, studentId } = await newOrg();
    const examId = await academyExam(orgId, 'active');
    await writeExamScores(
      pool,
      base(orgId, examId, { toUpsert: [{ studentId, score: 60, status: 'scored', notes: null }] }),
    );
    await writeExamScores(
      pool,
      base(orgId, examId, {
        userId: otherUserId,
        toUpsert: [{ studentId, score: 90, status: 'scored', notes: null }],
      }),
    );
    const [row] = await scores(examId);
    expect(Number(row!.score)).toBe(90);
    expect(row!.created_by).toBe(userId);
  });

  it('只記真的有變的格子；新增的 before 是 null、清空的 after 是 null', async () => {
    const { orgId, studentId } = await newOrg();
    const other = await one(
      `INSERT INTO students (org_id, name, grade) VALUES ($1, '李小華', 'J2')`,
      [orgId],
    );
    const examId = await academyExam(orgId, 'active');
    await q(
      `INSERT INTO academy_scores (exam_id, student_id, score, status, created_by) VALUES ($1, $2, 70, 'scored', $3)`,
      [examId, studentId, userId],
    );

    // 王小明送一樣的分數（沒變）、李小華新增
    await writeExamScores(
      pool,
      base(orgId, examId, {
        toUpsert: [
          { studentId, score: 70, status: 'scored', notes: null },
          { studentId: other, score: 55, status: 'scored', notes: null },
        ],
      }),
    );
    // 再把王小明清空
    await writeExamScores(pool, base(orgId, examId, { toDelete: [{ studentId }] }));

    const [up, del] = await audits(orgId);
    expect(up!.details['affected']).toBe(2);
    expect(up!.details['changes']).toEqual([
      {
        studentId: other,
        studentName: '李小華',
        before: null,
        after: { score: 55, status: 'scored', notes: null },
      },
    ]);
    expect(del!.action).toBe('academy_exam.scores.delete');
    expect(del!.details).toMatchObject({
      removed: [studentId],
      examClosed: false,
      changes: [
        {
          studentId,
          before: { score: 70, status: 'scored', notes: null },
          after: null,
        },
      ],
    });
  });

  it('紀錄寫不進去 → 整筆回滾：成績沒變、丟出例外', async () => {
    const { orgId, studentId } = await newOrg();
    const examId = await academyExam(orgId, 'closed');
    await q(
      `INSERT INTO academy_scores (exam_id, student_id, score, status, created_by) VALUES ($1, $2, 70, 'scored', $3)`,
      [examId, studentId, userId],
    );

    // 刪除不寫 created_by，所以只有稽核那一句會撞 ba_user 的 FK
    await expect(
      writeExamScores(
        pool,
        base(orgId, examId, { userId: `no-such-user-${randomUUID()}`, toDelete: [{ studentId }] }),
      ),
    ).rejects.toThrow();

    expect(await scores(examId)).toHaveLength(1);
    expect(await audits(orgId)).toHaveLength(0);
  });

  it('別機構的考試 → not-found，什麼都沒寫', async () => {
    const a = await newOrg();
    const b = await newOrg();
    const examId = await academyExam(a.orgId, 'active');
    const r = await writeExamScores(
      pool,
      base(b.orgId, examId, {
        toUpsert: [{ studentId: a.studentId, score: 99, status: 'scored', notes: null }],
      }),
    );
    expect(r).toEqual({ status: 'not-found' });
    expect(await scores(examId)).toHaveLength(0);
  });

  it('校內考：清空一科只刪那一科，同一個學生的其他科留著', async () => {
    const { orgId, studentId } = await newOrg();
    const schoolId = await one(`INSERT INTO schools (org_id, name) VALUES ($1, '信義國中')`, [
      orgId,
    ]);
    const math = await one(`INSERT INTO subjects (org_id, name) VALUES ($1, '數學')`, [orgId]);
    const eng = await one(`INSERT INTO subjects (org_id, name) VALUES ($1, '英文')`, [orgId]);
    const examId = await one(
      `INSERT INTO school_exams (org_id, academic_year, semester, exam_type, label, school_id, status)
       VALUES ($1, 115, 1, 'term_exam', '第一次段考', $2, 'closed')`,
      [orgId, schoolId],
    );
    const input = (over: Partial<WriteExamScoresInput>): WriteExamScoresInput => ({
      ...base(orgId, examId),
      kind: 'school',
      examName: '第一次段考',
      ...over,
    });
    await writeExamScores(
      pool,
      input({
        toUpsert: [
          { studentId, subjectId: math, score: 80, status: 'scored', notes: null },
          { studentId, subjectId: eng, score: 75, status: 'scored', notes: null },
        ],
      }),
    );
    const r = await writeExamScores(pool, input({ toDelete: [{ studentId, subjectId: math }] }));

    expect(r).toMatchObject({ status: 'done', examClosed: true });
    const left = await q<{ subject_id: string }>(
      `SELECT subject_id FROM school_scores WHERE school_exam_id = $1`,
      [examId],
    );
    expect(left.map((x) => x.subject_id)).toEqual([eng]);
    const del = (await audits(orgId)).find((x) => x.action === 'school_exam.scores.delete')!;
    expect(del.details).toMatchObject({
      removed: [{ studentId, subjectId: math }],
      changes: [{ studentId, subjectId: math, before: { score: 80 }, after: null }],
    });
  });
});
