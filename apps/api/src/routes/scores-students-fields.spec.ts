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
 * `GET /api/scores/students` 每列 `latest`／`deltaVsPrev`／`recentAbsentCount`＋`sort=grade`（#1314 G8）。
 * 用 `scope=all` 打（範圍判準在 scores-students-scope-all.spec）。
 */

const ORG = 'org-a';
const CA = '00000000-0000-0000-0000-0000000000ca';

const STUDENTS: Record<string, { name: string; grade: string | null }> = {
  s1: { name: '王一', grade: 'J3' },
  s2: { name: '李二', grade: 'P5' },
  s3: { name: '陳三', grade: 'J1' },
  s4: { name: '林四', grade: null },
};

const academy = (
  id: string,
  studentId: string,
  score: string | null,
  examDate: string,
  over: { total?: number; pass?: number | null; status?: string } = {},
) => ({
  id,
  exam_id: `ex-${id}`,
  student_id: studentId,
  score,
  status: over.status ?? 'scored',
  created_at: '2027-01-01T00:00:00Z',
  academy_exams: {
    name: `考試 ${id}`,
    exam_date: examDate,
    total_score: over.total ?? 100,
    pass_score: over.pass ?? null,
    scope_note: null,
    org_id: ORG,
    subject_id: null,
    subjects: null,
    academy_exam_classes: [],
  },
  students: STUDENTS[studentId],
});
const school = (id: string, studentId: string, examDate: string, status = 'absent') => ({
  id,
  school_exam_id: `sx-${id}`,
  student_id: studentId,
  subject_id: 'sub',
  score: null,
  status,
  created_at: '2027-01-01T00:00:00Z',
  school_exams: {
    label: '段考',
    exam_date: examDate,
    created_at: '2027-01-01T00:00:00Z',
    org_id: ORG,
  },
  subjects: { name: '數學' },
  students: STUDENTS[studentId],
});

const TABLES = {
  enrollments: ['s1', 's2', 's3', 's4'].map((s) => ({
    id: `e-${s}`,
    org_id: ORG,
    student_id: s,
    class_id: 'c1',
    status: 'active',
    classes: { campus_id: CA },
  })),
  academy_scores: [
    // s1：上一場 29/50＝58%，最近一場 69/100（及格線 70）→ 不及格、差 +11
    academy('a1', 's1', '29', '2027-02-01', { total: 50 }),
    academy('a2', 's1', '69', '2027-03-01', { pass: 70 }),
    academy('a3', 's1', null, '2027-03-10', { status: 'absent' }), // 缺考不是「最近一場有分數」
    // s2：只有一場，剛好及格線
    academy('a4', 's2', '70', '2027-03-01', { pass: 70 }),
    // s3：同日兩場，id 大者算最近
    academy('a5', 's3', '50', '2027-03-05'),
    academy('a6', 's3', '90', '2027-03-05'),
    // 缺考的 30 天邊界：今天−30 算、今天−31 不算
    academy('a7', 's4', null, '2027-02-13', { status: 'absent' }),
    academy('a8', 's4', null, '2027-02-12', { status: 'absent' }),
  ],
  school_scores: [school('b1', 's4', '2027-03-15'), school('b2', 's4', '2027-03-16')], // 今天算、明天不算
};

async function list(query = '') {
  const db = createMultiOrgDb(TABLES);
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'u1');
    set('roles', ['admin']);
    set('campusScope', null);
    await next();
  });
  app.route('/', scoresRoute as unknown as Hono);
  const res = await app.request(`/students?scope=all${query}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: Array<Record<string, any>> };
  return body.data;
}
const byId = async (query = '') =>
  Object.fromEntries((await list(query)).map((r) => [r['studentId'], r]));

describe('GET /api/scores/students —— 列欄位（#1314 G8）', () => {
  it('latest＝最近一場有分數的校內考；failing 照該場及格線；delta 換算 100 分制', async () => {
    const rows = await byId();
    expect(rows['s1']).toMatchObject({
      grade: 'J3',
      latest: {
        score: 69,
        totalScore: 100,
        examName: '考試 a2',
        examDate: '2027-03-01',
        failing: true,
      },
    });
    expect(rows['s1']!['deltaVsPrev']).toBeCloseTo(11, 6);
  });

  it('剛好及格線不算不及格；只有一場時 delta 為 null', async () => {
    const rows = await byId();
    expect(rows['s2']).toMatchObject({ latest: { score: 70, failing: false }, deltaVsPrev: null });
  });

  it('同日兩場：id 大者為最近', async () => {
    const rows = await byId();
    expect(rows['s3']).toMatchObject({
      latest: { examName: '考試 a6', score: 90 },
      deltaVsPrev: 40,
    });
  });

  it('沒有分數的學生 latest 為 null', async () => {
    const rows = await byId();
    expect(rows['s4']).toMatchObject({ latest: null, deltaVsPrev: null });
  });

  it('recentAbsentCount：近 30 天（含今天−30、含今天），校內考＋段考；absentCount 仍是全部', async () => {
    const rows = await byId();
    // a7（−30）＋b1（今天）；a8（−31）與 b2（明天）不算
    expect(rows['s4']).toMatchObject({ recentAbsentCount: 2, absentCount: 4 });
    expect(rows['s1']).toMatchObject({ recentAbsentCount: 1 });
  });

  it('sort=grade：年級序 P→J，沒有年級的排最後；預設照姓名', async () => {
    expect((await list('&sort=grade')).map((r) => r['studentId'])).toEqual([
      's2',
      's3',
      's1',
      's4',
    ]);
    const byName = (await list()).map((r) => r['studentName']);
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b, 'zh-Hant')));
  });
});
