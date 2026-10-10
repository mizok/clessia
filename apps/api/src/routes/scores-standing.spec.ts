import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import scoresRoute, { examStanding } from './scores';

/**
 * #1314 G10／SD4：逐場成績帶班平均與名次，摘要帶最近一場校內考。
 * 母體＝整場考試的 scored 應考者（不依分校縮，計畫席 10-10 記可否決）。
 */

describe('examStanding', () => {
  it('平均取 1 位小數、名次＝1＋比他高的人數（同分同名次）', () => {
    expect(examStanding([90, 80, 80, 71], 80)).toEqual({ classAvg: 80.3, rank: 2, classSize: 4 });
    expect(examStanding([90, 80, 80, 71], 90)).toEqual({ classAvg: 80.3, rank: 1, classSize: 4 });
  });

  it('自己沒分數、或這場沒人有分數 → 全 null', () => {
    const none = { classAvg: null, rank: null, classSize: null };
    expect(examStanding([90, 80], null)).toEqual(none);
    expect(examStanding([], 80)).toEqual(none);
    expect(examStanding(undefined, 80)).toEqual(none);
  });
});

const ORG = 'org-a';
const S1 = '00000000-0000-0000-0000-0000000000a1';
const exam = (id: string, date: string, org = ORG) => ({
  name: `小考${id}`,
  exam_date: date,
  total_score: 100,
  pass_score: 60,
  scope_note: null,
  org_id: org,
  subject_id: 'sub-1',
  subjects: { name: '數學' },
});
const score = (
  id: string,
  examId: string,
  studentId: string,
  value: number | null,
  status = 'scored',
  examDate = '2026-03-01',
  org = ORG,
) => ({
  id,
  exam_id: examId,
  student_id: studentId,
  score: value,
  status,
  created_at: '2026-03-02T00:00:00Z',
  academy_exams: exam(examId, examDate, org),
  students: { name: studentId === S1 ? '小明' : studentId },
});

function app(extraScores: ReturnType<typeof score>[] = []) {
  const db = createMultiOrgDb({
    students: [{ id: S1, org_id: ORG, name: '小明', school_id: null, enrollments: [] }],
    academy_scores: [
      // e1：小明 80，同場另有 90／80／71／缺考 → 平均 80.3、第 2、4 人
      score('a1', 'e1', S1, 80),
      score('a2', 'e1', 's2', 90),
      score('a3', 'e1', 's3', 80),
      score('a4', 'e1', 's4', 71),
      score('a5', 'e1', 's5', null, 'absent'),
      // 補考但留著舊分數（DB 沒有約束擋這種列）—— 不能算進母體
      score('a6', 'e1', 's6', 100, 'makeup'),
      // e2（較新）：小明缺考 → 三欄 null；別人有分數
      score('b1', 'e2', S1, null, 'absent', '2026-03-08'),
      score('b2', 'e2', 's2', 70, 'scored', '2026-03-08'),
      // 別 org 同 exam id 的成績不能混進母體
      score('x1', 'e1', 'sx', 0, 'scored', '2026-03-01', 'org-b'),
      ...extraScores,
    ],
    school_scores: [],
  });
  const hono = new Hono();
  hono.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'u1');
    set('roles', ['admin']);
    set('campusScope', null);
    await next();
  });
  hono.route('/', scoresRoute as unknown as Hono);
  return hono;
}

describe('GET /scores?studentId —— 每筆帶 examId／classAvg／rank／classSize', () => {
  it('有分數的那場帶位置；缺考那場三欄 null', async () => {
    const res = await app().request(`/?studentId=${S1}&type=academy`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        examId: string;
        classAvg: number | null;
        rank: number | null;
        classSize: number | null;
      }>;
    };
    const byExam = Object.fromEntries(
      body.data.map((r) => [r.examId, [r.classAvg, r.rank, r.classSize]]),
    );
    expect(byExam).toEqual({ e1: [80.3, 2, 4], e2: [null, null, null] });
  });
});

describe('GET /scores/student/{id}/summary —— latestAcademy', () => {
  it('最近一場「有分數」的校內考（較新的那場缺考 → 取 e1）', async () => {
    const res = await app().request(`/student/${S1}/summary`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { latestAcademy: Record<string, unknown> | null } };
    expect(body.data.latestAcademy).toMatchObject({
      examId: 'e1',
      score: 80,
      totalScore: 100,
      classAvg: 80.3,
      rank: 2,
      classSize: 4,
    });
  });

  it('兩場都有分數 → 取 exam_date 較新的那場（較新的排在後面，拿掉排序或對調都會取到 e1）', async () => {
    const res = await app([score('c1', 'e3', S1, 95, 'scored', '2026-03-05')]).request(
      `/student/${S1}/summary`,
    );
    const body = (await res.json()) as { data: { latestAcademy: Record<string, unknown> | null } };
    expect(body.data.latestAcademy).toMatchObject({ examId: 'e3', score: 95 });
  });
});
