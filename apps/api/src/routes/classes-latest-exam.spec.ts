import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb, withMaxRows } from '../test-utils/multi-org-db';
import classesRoute from './classes';

/**
 * `GET /classes` 每列 `latestExam`（#1314 G6）。判準在 `lib/class-latest-exam.ts`。
 * `multi-org-db` 不解析 select，`academy_exam_classes` 列直接帶 embed 形狀。
 */

const ORG = 'org-a';
const OTHER = 'org-b';
const klass = (id: string) => ({
  id,
  org_id: ORG,
  course_id: 'k1',
  campus_id: 'campus-1',
  name: id,
  is_active: true,
  max_students: 24,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});
const enr = (classId: string, studentId: string, status = 'active') => ({
  id: `e-${classId}-${studentId}`,
  org_id: ORG,
  class_id: classId,
  student_id: studentId,
  status,
  effective_from: '2000-01-01',
  effective_to: null,
});
const exam = (
  id: string,
  examDate: string,
  scoreCount: number,
  over: Record<string, unknown> = {},
) => ({
  id,
  name: `考試 ${id}`,
  exam_date: examDate,
  total_score: 100,
  pass_score: 70,
  org_id: ORG,
  academy_scores: [{ count: scoreCount }],
  ...over,
});
const link = (classId: string, e: ReturnType<typeof exam>) => ({
  class_id: classId,
  exam_id: e.id,
  academy_exams: e,
});
const score = (examId: string, studentId: string, value: string | null, status = 'scored') => ({
  id: `s-${examId}-${studentId}`,
  exam_id: examId,
  student_id: studentId,
  score: value,
  status,
});

const E_OLD = exam('e1', '2027-01-10', 1);
const E_NEW = exam('e2', '2027-02-01', 6);
const E_EMPTY = exam('e3', '2027-03-01', 0); // 較新但沒成績
const E_FOREIGN = exam('e9', '2027-04-01', 1, { org_id: OTHER }); // 別 org，不該被挑

const BASE = {
  classes: [klass('c1'), klass('c2'), klass('c3')],
  enrollments: [
    enr('c1', 's1'),
    enr('c1', 's2'),
    enr('c1', 's3'),
    enr('c1', 's4'),
    enr('c1', 's6', 'void'),
    enr('c2', 's5'),
  ],
  academy_exam_classes: [
    link('c1', E_OLD),
    link('c1', E_NEW),
    link('c2', E_NEW), // 一場考試綁兩班
    link('c1', E_EMPTY),
    link('c1', E_FOREIGN),
  ],
  academy_scores: [
    score('e1', 's1', '10'),
    score('e2', 's1', '69'), // 及格線 70：不及格
    score('e2', 's2', '70'), // 剛好及格
    score('e2', 's3', null, 'absent'),
    score('e2', 's4', null, 'makeup'),
    score('e2', 's5', '90'), // c2 的學生
    score('e2', 's6', '10'), // c1 的作廢報名：不算
  ],
};

async function list(tables: Record<string, Array<Record<string, unknown>>>, maxRows?: number) {
  const db = createMultiOrgDb(tables);
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', maxRows ? withMaxRows(db.client, maxRows) : db.client);
    set('orgId', ORG);
    set('userId', 'u1');
    set('roles', ['admin']);
    set('campusScope', null);
    await next();
  });
  app.route('/', classesRoute as unknown as Hono);
  const res = await app.request('/');
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: Array<{ id: string; latestExam?: unknown }> };
  return Object.fromEntries(body.data.map((row) => [row.id, row.latestExam]));
}

describe('GET /classes —— latestExam（#1314 G6）', () => {
  it('挑最新且有成績的那場；平均只含 scored、缺考另計、作廢報名不算；別 org 的考試不挑', async () => {
    const rows = await list(BASE);
    expect(rows['c1']).toEqual({
      examId: 'e2',
      name: '考試 e2',
      examDate: '2027-02-01',
      totalScore: 100,
      avgScore: 69.5,
      failCount: 1,
      absentCount: 1,
    });
  });

  it('多班考試：成績歸給學生有報名的那班', async () => {
    const rows = await list(BASE);
    expect(rows['c2']).toMatchObject({ examId: 'e2', avgScore: 90, failCount: 0, absentCount: 0 });
  });

  it('沒有考試的班是 null（不是 undefined）', async () => {
    const rows = await list(BASE);
    expect(rows['c3']).toBeNull();
  });

  it('沒設及格線走總分 60%：總分 50 時 29 不及格、30 及格', async () => {
    const e = exam('e5', '2027-02-01', 2, { pass_score: null, total_score: 50 });
    const rows = await list({
      ...BASE,
      academy_exam_classes: [link('c1', e)],
      academy_scores: [score('e5', 's1', '29'), score('e5', 's2', '30')],
    });
    expect(rows['c1']).toMatchObject({ totalScore: 50, avgScore: 29.5, failCount: 1 });
  });

  it('全員缺考：avgScore null、absentCount 算到', async () => {
    const e = exam('e6', '2027-02-01', 1);
    const rows = await list({
      ...BASE,
      academy_exam_classes: [link('c1', e)],
      academy_scores: [score('e6', 's1', null, 'absent')],
    });
    expect(rows['c1']).toMatchObject({ avgScore: null, failCount: 0, absentCount: 1 });
  });

  // 陷阱：PostgREST 撈列只回前 1000 列、不報錯 —— 最新那場排在第 1001 列
  it('考試連結破千：第 1001 筆的最新考試也挑得到', async () => {
    const old = Array.from({ length: 1000 }, (_, i) =>
      link('c1', exam(`a${String(i).padStart(4, '0')}`, '2026-01-01', 1)),
    );
    const newest = exam('z-latest', '2027-05-01', 1);
    const rows = await list(
      {
        ...BASE,
        academy_exam_classes: [...old, link('c1', newest)],
        academy_scores: [score('z-latest', 's1', '88')],
      },
      1000,
    );
    expect(rows['c1']).toMatchObject({ examId: 'z-latest', avgScore: 88 });
  });
});
