import type { Pool, PoolClient } from 'pg';

import { withTx } from './pg-tx';

/**
 * 寫一場考試的成績，連同「改了什麼」的操作紀錄，在同一個交易裡（#1931）。
 *
 * 考試標完成後仍可修改（使用者 10-23 裁，照 A6 scores：「改過的會記在操作紀錄」）。那行字的前提是
 * **改了就一定有紀錄** —— 而 `logAudit` 是 fire-and-forget，寫失敗只在 console 留一行、成績照存。
 * 所以成績與紀錄同生同死：紀錄寫不進去就整筆回滾（pg-pool-writes rule 1、2）。
 *
 * - 每一次寫入都記 diff（不只完成後，計畫席 10-23 Q1）：`details.changes` 列真的有變的那幾格，
 *   `before`／`after` 是 `{ score, status, notes }`，新增時 `before` 是 null、清空時 `after` 是 null。
 * - `created_by` 只在第一次登錄時寫（Q2）：之後改的人只進操作紀錄，家長端「X 老師登錄」不會變成最後改的人。
 * - 考試在交易裡鎖住並重驗 org（rule 4）；成績表沒有 `org_id`，一律掛在這場已驗過的考試底下。
 * - 授權（任課班、科目、學生屬於這個機構）由路由在交易外先查，這裡不重做。
 */

export type ExamKind = 'academy' | 'school';

export interface ScoreUpsert {
  readonly studentId: string;
  /** 校內考才有；補習班考試一場就是一科 */
  readonly subjectId?: string;
  readonly score: number | null;
  readonly status: string;
  readonly notes: string | null;
}

export interface ScoreKey {
  readonly studentId: string;
  readonly subjectId?: string;
}

export interface WriteExamScoresInput {
  readonly kind: ExamKind;
  readonly orgId: string;
  readonly userId: string;
  /** 交易外查好的顯示名（`loadDisplayName`）；查不到就 null，不擋寫入 */
  readonly userName: string | null;
  readonly examId: string;
  readonly examName: string | null;
  readonly toUpsert: readonly ScoreUpsert[];
  readonly toDelete: readonly ScoreKey[];
}

interface CellValue {
  readonly score: number | null;
  readonly status: string;
  readonly notes: string | null;
}

export interface ScoreChange {
  readonly studentId: string;
  readonly studentName: string | null;
  readonly subjectId?: string;
  readonly before: CellValue | null;
  readonly after: CellValue | null;
}

export type WriteExamScoresOutcome =
  | { readonly status: 'not-found' }
  | {
      readonly status: 'done';
      readonly examClosed: boolean;
      readonly upsertChanges: readonly ScoreChange[];
      readonly deleteChanges: readonly ScoreChange[];
    };

const TABLES = {
  academy: {
    exam: 'academy_exams',
    scores: 'academy_scores',
    fk: 'exam_id',
    resource: 'academy_exam',
  },
  school: {
    exam: 'school_exams',
    scores: 'school_scores',
    fk: 'school_exam_id',
    resource: 'school_exam',
  },
} as const;

const keyOf = (k: ScoreKey) => `${k.studentId}|${k.subjectId ?? ''}`;

/** numeric 從 pg 回來是字串；比較與紀錄都用數字 */
const toCell = (r: Record<string, unknown>): CellValue => ({
  score: r['score'] === null || r['score'] === undefined ? null : Number(r['score']),
  status: String(r['status']),
  notes: (r['notes'] as string | null) ?? null,
});

const sameCell = (a: CellValue, b: CellValue) =>
  a.score === b.score && a.status === b.status && a.notes === b.notes;

export async function writeExamScores(
  pool: Pool,
  input: WriteExamScoresInput,
): Promise<WriteExamScoresOutcome> {
  const t = TABLES[input.kind];
  const school = input.kind === 'school';

  return withTx(pool, async (db) => {
    const exam = await db.query<{ status: string }>(
      `SELECT status::text AS status FROM ${t.exam} WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [input.examId, input.orgId],
    );
    if (exam.rowCount === 0) return { status: 'not-found' } as const;
    const examClosed = exam.rows[0]!.status === 'closed';

    const keys = [...input.toUpsert, ...input.toDelete];
    const studentIds = [...new Set(keys.map((k) => k.studentId))];
    if (studentIds.length === 0) {
      return { status: 'done', examClosed, upsertChanges: [], deleteChanges: [] } as const;
    }

    const before = await readBefore(db, t, input.examId, studentIds, school);
    const names = await studentNames(db, input.orgId, studentIds);

    if (input.toUpsert.length > 0) await upsertRows(db, t, input, school);
    if (input.toDelete.length > 0) await deleteRows(db, t, input, school);

    const change = (k: ScoreKey, after: CellValue | null): ScoreChange | null => {
      const prev = before.get(keyOf(k)) ?? null;
      if (prev === null && after === null) return null;
      if (prev !== null && after !== null && sameCell(prev, after)) return null;
      return {
        studentId: k.studentId,
        studentName: names.get(k.studentId) ?? null,
        ...(school ? { subjectId: k.subjectId } : {}),
        before: prev,
        after,
      };
    };
    const upsertChanges = input.toUpsert
      .map((u) => change(u, { score: u.score, status: u.status, notes: u.notes }))
      .filter((c): c is ScoreChange => c !== null);
    const deleteChanges = input.toDelete
      .map((k) => change(k, null))
      .filter((c): c is ScoreChange => c !== null);

    // 事件名與既有鍵（affected／removed）照舊：操作紀錄頁與舊資料不用跟著改
    if (input.toUpsert.length > 0) {
      await insertAudit(db, input, t.resource, `${t.resource}.scores.upsert`, {
        affected: input.toUpsert.length,
        examClosed,
        changes: upsertChanges,
      });
    }
    if (input.toDelete.length > 0) {
      await insertAudit(db, input, t.resource, `${t.resource}.scores.delete`, {
        removed: school
          ? input.toDelete.map((k) => ({ studentId: k.studentId, subjectId: k.subjectId }))
          : input.toDelete.map((k) => k.studentId),
        examClosed,
        changes: deleteChanges,
      });
    }

    return { status: 'done', examClosed, upsertChanges, deleteChanges } as const;
  });
}

type Tables = (typeof TABLES)[ExamKind];

async function readBefore(
  db: PoolClient,
  t: Tables,
  examId: string,
  studentIds: string[],
  school: boolean,
): Promise<Map<string, CellValue>> {
  const res = await db.query(
    `SELECT student_id, ${school ? 'subject_id' : 'NULL::uuid AS subject_id'},
            score, status::text AS status, notes
       FROM ${t.scores}
      WHERE ${t.fk} = $1 AND student_id = ANY($2::uuid[])
      FOR UPDATE`,
    [examId, studentIds],
  );
  return new Map(
    res.rows.map((r) => [
      keyOf({ studentId: r['student_id'], subjectId: r['subject_id'] ?? undefined }),
      toCell(r),
    ]),
  );
}

async function studentNames(
  db: PoolClient,
  orgId: string,
  studentIds: string[],
): Promise<Map<string, string>> {
  const res = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM students WHERE org_id = $1 AND id = ANY($2::uuid[])`,
    [orgId, studentIds],
  );
  return new Map(res.rows.map((r) => [r.id, r.name]));
}

async function upsertRows(
  db: PoolClient,
  t: Tables,
  input: WriteExamScoresInput,
  school: boolean,
): Promise<void> {
  const rows = input.toUpsert;
  // `created_by` 只在新增時寫；ON CONFLICT 不碰它（Q2）
  await db.query(
    `INSERT INTO ${t.scores} (${t.fk}, student_id, ${school ? 'subject_id, ' : ''}score, status, notes, created_by)
     SELECT $1, s.student_id, ${school ? 's.subject_id, ' : ''}s.score, s.status::score_status, s.notes, $2
       FROM unnest($3::uuid[], $4::uuid[], $5::numeric[], $6::text[], $7::text[])
         AS s(student_id, subject_id, score, status, notes)
     ON CONFLICT (${t.fk}, student_id${school ? ', subject_id' : ''})
     DO UPDATE SET score = EXCLUDED.score, status = EXCLUDED.status, notes = EXCLUDED.notes,
                   updated_at = now()`,
    [
      input.examId,
      input.userId,
      rows.map((r) => r.studentId),
      rows.map((r) => r.subjectId ?? null),
      rows.map((r) => r.score),
      rows.map((r) => r.status),
      rows.map((r) => r.notes),
    ],
  );
}

async function deleteRows(
  db: PoolClient,
  t: Tables,
  input: WriteExamScoresInput,
  school: boolean,
): Promise<void> {
  // 校內考的唯一鍵有三段：只用 student_id 刪會把同一個學生沒清空的其他科一起刪掉
  await db.query(
    school
      ? `DELETE FROM ${t.scores} AS s
          USING unnest($2::uuid[], $3::uuid[]) AS k(student_id, subject_id)
          WHERE s.${t.fk} = $1 AND s.student_id = k.student_id AND s.subject_id = k.subject_id`
      : `DELETE FROM ${t.scores} WHERE ${t.fk} = $1 AND student_id = ANY($2::uuid[])`,
    school
      ? [
          input.examId,
          input.toDelete.map((k) => k.studentId),
          input.toDelete.map((k) => k.subjectId),
        ]
      : [input.examId, input.toDelete.map((k) => k.studentId)],
  );
}

async function insertAudit(
  db: PoolClient,
  input: WriteExamScoresInput,
  resourceType: string,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (org_id, user_id, user_name, resource_type, resource_id, resource_name, action, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      input.orgId,
      input.userId,
      input.userName,
      resourceType,
      input.examId,
      input.examName,
      action,
      JSON.stringify(details),
    ],
  );
}
