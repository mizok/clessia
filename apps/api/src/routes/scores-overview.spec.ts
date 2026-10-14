import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

// 假時鐘離真實日期遠：「改回真實今天」的突變才會紅
vi.mock('../lib/taipei-date', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/taipei-date')>()),
  getCurrentTaipeiDateString: () => '2027-03-15',
}));

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import scoresRoute from './scores';

/**
 * `GET /api/scores/overview`（#1314 G5）。`multi-org-db` 不解析 select，列直接帶 embed 形狀。
 * 窗：days=30 → [2027-02-13, 2027-03-15]。
 */

const ORG = 'org-a';
const OTHER = 'org-b';
const CA = '00000000-0000-0000-0000-0000000000ca';
const CB = '00000000-0000-0000-0000-0000000000cb';

const exam = (
  id: string,
  examDate: string,
  classes: Array<[string, string]>,
  over: Record<string, unknown> = {},
) => ({
  id,
  org_id: ORG,
  campus_id: CA,
  name: `考試 ${id}`,
  exam_date: examDate,
  total_score: 100,
  pass_score: null,
  academy_exam_classes: classes.map(([class_id, name]) => ({ class_id, classes: { name } })),
  ...over,
});
const score = (examId: string, studentId: string, value: string | null, status = 'scored') => ({
  id: `s-${examId}-${studentId}`,
  exam_id: examId,
  student_id: studentId,
  score: value,
  status,
  students: { name: `學生 ${studentId}`, grade: 'J3' },
});
const enr = (classId: string, studentId: string) => ({
  id: `e-${classId}-${studentId}`,
  org_id: ORG,
  class_id: classId,
  student_id: studentId,
  status: 'active',
  effective_from: '2000-01-01',
  effective_to: null,
});

const C1: [string, string] = ['c1', '一班'];
const C2: [string, string] = ['c2', '二班'];

const TABLES = {
  academy_exams: [
    exam('ea1', '2027-03-10', [C1], { pass_score: 70 }),
    exam('ez0', '2027-02-20', [C1], { total_score: 50 }),
    exam('eb', '2027-03-01', [C2], { campus_id: CB }),
    exam('edge-in', '2027-02-13', []), // 今天 − 30：算
    exam('edge-out', '2027-02-12', []), // 今天 − 31：不算
    exam('pending', '2027-03-12', [C1]), // 一筆都沒登
    exam('foreign', '2027-03-11', [C1], { org_id: OTHER }),
  ],
  academy_scores: [
    score('ea1', 's1', '69'), // 及格線 70：不及格
    score('ea1', 's2', '70'), // 剛好及格
    score('ea1', 's3', null, 'absent'),
    score('ea1', 's4', null, 'makeup'),
    score('ez0', 's1', '29'), // 29/50＝58%，但 s1 最近一場是 ea1
    score('ez0', 's2', '30'),
    score('eb', 's5', '59'),
    score('eb', 's6', '61'),
    score('edge-in', 's7', '80'),
    score('edge-out', 's8', '10'),
    score('foreign', 's9', '0'),
  ],
  enrollments: [
    enr('c1', 's1'),
    enr('c1', 's2'),
    enr('c1', 's3'),
    enr('c1', 's4'),
    enr('c2', 's5'),
    enr('c2', 's6'),
  ],
};

async function overview(query = '', opts: { roles?: string[]; scope?: string[] | null } = {}) {
  const db = createMultiOrgDb(TABLES);
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'u1');
    set('roles', opts.roles ?? ['admin']);
    set('campusScope', opts.scope ?? null);
    await next();
  });
  app.route('/', scoresRoute as unknown as Hono);
  const res = await app.request(`/overview${query}`);
  return { status: res.status, body: (await res.json()) as any };
}

describe('GET /api/scores/overview（#1314 G5）', () => {
  it('摘要：窗內 5 場（含今天−30、不含今天−31、別 org 不進），2 場沒登完，平均換算 100 分制', async () => {
    const { status, body } = await overview('?days=30');
    expect(status).toBe(200);
    expect(body.windowDays).toBe(30);
    expect(body.exams.count).toBe(5);
    // pending：一筆都沒登；ez0：4 人在籍只登 2
    expect(body.exams.pendingCount).toBe(2);
    // 69、70、58、60、59、61、80 —— 缺考、補考不進分子分母
    expect(body.exams.avgScore).toBeCloseTo(457 / 7, 6);
  });

  it('不帶 days 預設 30', async () => {
    const { body } = await overview();
    expect(body.windowDays).toBe(30);
    expect(body.exams.count).toBe(5);
  });

  it('不及格學生：每生只看最近一場，依得分率升冪；剛好及格線不算', async () => {
    const { body } = await overview();
    expect(body.failingTotal).toBe(2);
    expect(body.failingStudents).toEqual([
      {
        studentId: 's5',
        name: '學生 s5',
        grade: 'J3',
        className: '二班',
        examName: '考試 eb',
        examDate: '2027-03-01',
        score: 59,
        totalScore: 100,
      },
      expect.objectContaining({
        studentId: 's1',
        examName: '考試 ea1',
        score: 69,
        className: '一班',
      }),
    ]);
  });

  it('班平均最低：每班最近一場有成績的（沒登的那場跳過），依得分率升冪', async () => {
    const { body } = await overview();
    expect(body.totalClasses).toBe(2);
    expect(body.lowestClasses).toEqual([
      expect.objectContaining({ classId: 'c2', examId: 'eb', avgScore: 60, failCount: 1 }),
      expect.objectContaining({
        classId: 'c1',
        className: '一班',
        examId: 'ea1',
        totalScore: 100,
        avgScore: 69.5,
        failCount: 1,
        absentCount: 1,
      }),
    ]);
  });

  it('最近的考試：考試日降冪，一場一列，還差人數＝分母−已登錄', async () => {
    const { body } = await overview();
    expect(body.recentExams.map((e: any) => e.examId)).toEqual([
      'pending',
      'ea1',
      'eb',
      'ez0',
      'edge-in',
    ]);
    const byId = Object.fromEntries(body.recentExams.map((e: any) => [e.examId, e]));
    expect(byId['ea1']).toMatchObject({
      className: '一班',
      avgScore: 69.5,
      failCount: 1,
      absentCount: 1,
      missingCount: 0,
    });
    expect(byId['pending']).toMatchObject({ avgScore: null, missingCount: 4 });
    expect(byId['ez0']).toMatchObject({ totalScore: 50, avgScore: 29.5, missingCount: 2 });
  });

  it('campusId：只算該校的考試', async () => {
    const { body } = await overview(`?campusId=${CB}`);
    expect(body.exams.count).toBe(1);
    expect(body.recentExams.map((e: any) => e.examId)).toEqual(['eb']);
  });

  it('受限 [A] 指名 B：交集為空，撐不大範圍', async () => {
    const { body } = await overview(`?campusId=${CB}`, { scope: [CA] });
    expect(body.exams).toEqual({ count: 0, pendingCount: 0, avgScore: null });
    expect(body.failingStudents).toEqual([]);
  });

  it('受限 [A] 不指名：B 校的考試不進', async () => {
    const { body } = await overview('', { scope: [CA] });
    expect(body.recentExams.map((e: any) => e.examId)).not.toContain('eb');
  });

  it('老師 403', async () => {
    const { status } = await overview('', { roles: ['teacher'] });
    expect(status).toBe(403);
  });

  it('days 超出 1–365 → 400', async () => {
    expect((await overview('?days=0')).status).toBe(400);
    expect((await overview('?days=366')).status).toBe(400);
  });
});
