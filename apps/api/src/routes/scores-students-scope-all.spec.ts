import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb, withMaxRows } from '../test-utils/multi-org-db';
import scoresRoute from './scores';

/**
 * `GET /api/scores/students?scope=all`（#1314 G8，保留類）。
 * 可見範圍＝`campusFilterIds(受限範圍, campusId)` 底下任一報名（不分狀態）在那些校的學生 —— 同 `/students` 列表。
 * `multi-org-db` 不解析 select，列直接帶 embed 形狀。
 */

const ORG = 'org-a';
const OTHER = 'org-b';
const CA = '00000000-0000-0000-0000-0000000000ca';
const CB = '00000000-0000-0000-0000-0000000000cb';
const C1 = '00000000-0000-0000-0000-0000000000c1';

const enr = (studentId: string, campusId: string, over: Record<string, unknown> = {}) => ({
  id: `e-${studentId}-${campusId}`,
  org_id: ORG,
  student_id: studentId,
  class_id: C1,
  status: 'active',
  classes: { campus_id: campusId },
  ...over,
});
const examOf = (org: string) => ({
  name: '小考',
  exam_date: '2027-03-01',
  total_score: 100,
  pass_score: null,
  scope_note: null,
  org_id: org,
  subject_id: null,
  subjects: null,
  academy_exam_classes: [{ class_id: C1, classes: { name: '一班' } }],
});
const academy = (n: number, studentId: string, score: string, org = ORG) => ({
  id: `a-${String(n).padStart(5, '0')}`,
  exam_id: 'ex-1',
  student_id: studentId,
  score,
  status: 'scored',
  created_at: '2027-03-01T00:00:00Z',
  academy_exams: examOf(org),
  students: { name: `學生 ${studentId}` },
});

const BASE = {
  enrollments: [
    enr('s1', CA),
    enr('s2', CB),
    enr('s3', CA),
    enr('s3', CB, { id: 'e-s3-b', status: 'withdrawal' }), // 退班的也算（同 /students）
    enr('sx', CA, { org_id: OTHER }),
  ],
  academy_scores: [
    academy(1, 's1', '80'),
    academy(2, 's2', '70'),
    academy(3, 's3', '90'),
    academy(4, 'sx', '50', OTHER), // 別 org 的成績
  ],
  school_scores: [] as Array<Record<string, unknown>>,
  academy_exam_classes: [{ exam_id: 'ex-1', class_id: C1 }],
};

async function get(
  query: string,
  opts: { scope?: string[] | null; tables?: Record<string, unknown[]>; maxRows?: number } = {},
) {
  const db = createMultiOrgDb(
    (opts.tables ?? BASE) as Record<string, Array<Record<string, unknown>>>,
  );
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', opts.maxRows ? withMaxRows(db.client, opts.maxRows) : db.client);
    set('orgId', ORG);
    set('userId', 'u1');
    set('roles', ['admin']);
    set('campusScope', opts.scope ?? null);
    await next();
  });
  app.route('/', scoresRoute as unknown as Hono);
  const res = await app.request(`/students${query}`);
  const body = (await res.json()) as any;
  return {
    status: res.status,
    code: body.code as string | undefined,
    ids: ((body.data ?? []) as Array<{ studentId: string }>).map((r) => r.studentId).sort(),
    body,
  };
}

describe('GET /api/scores/students?scope=all（#1314 G8）', () => {
  it('不受限、不指名：本 org 全部有成績的學生；別 org 的不進', async () => {
    const { status, ids } = await get('?scope=all');
    expect(status).toBe(200);
    expect(ids).toEqual(['s1', 's2', 's3']);
  });

  it('指名 A：A 校有報名的學生（跨校學生也算）', async () => {
    expect((await get(`?scope=all&campusId=${CA}`)).ids).toEqual(['s1', 's3']);
  });

  it('指名 B：退班的報名也算進 B（同 /students 不濾報名狀態）', async () => {
    expect((await get(`?scope=all&campusId=${CB}`)).ids).toEqual(['s2', 's3']);
  });

  it('受限 [A] 不指名：只有 A', async () => {
    expect((await get('?scope=all', { scope: [CA] })).ids).toEqual(['s1', 's3']);
  });

  it('受限 [A] 指名 B：交集為空，撐不大範圍', async () => {
    const { status, ids } = await get(`?scope=all&campusId=${CB}`, { scope: [CA] });
    expect(status).toBe(200);
    expect(ids).toEqual([]);
  });

  it('受限 [A,B] 指名 B：只有 B', async () => {
    expect((await get(`?scope=all&campusId=${CB}`, { scope: [CA, CB] })).ids).toEqual(['s2', 's3']);
  });

  it.each([
    `classId=${C1}`,
    'courseId=00000000-0000-0000-0000-0000000000d1',
    'studentId=00000000-0000-0000-0000-0000000000e1',
    'type=academy',
    'subjectId=00000000-0000-0000-0000-0000000000f1',
    'dateFrom=2027-01-01',
    'dateTo=2027-12-31',
    'search=王',
  ])('scope=all 搭 %s → 400 SCOPE_ALL_PARAMS', async (extra) => {
    const { status, code } = await get(`?scope=all&${extra}`);
    expect(status).toBe(400);
    expect(code).toBe('SCOPE_ALL_PARAMS');
  });

  it('campusId 沒搭 scope=all → 400（不默默忽略）', async () => {
    const { status, code } = await get(`?classId=${C1}&campusId=${CA}`);
    expect(status).toBe(400);
    expect(code).toBe('SCOPE_ALL_PARAMS');
  });

  it('沒有 scope 也沒有 classId／courseId／studentId → 照舊 SCOPE_REQUIRED', async () => {
    expect((await get('')).code).toBe('SCOPE_REQUIRED');
  });

  // 陷阱：PostgREST 撈列只回前 1000 列、不報錯
  it('scope=all 成績破千：分頁撈齊，1001 筆都算到', async () => {
    const tables = {
      ...BASE,
      academy_scores: Array.from({ length: 1001 }, (_, i) => academy(i + 1, 's1', '80')),
    };
    const { status, body } = await get('?scope=all', { tables, maxRows: 1000 });
    expect(status).toBe(200);
    expect(body.data[0]).toMatchObject({ studentId: 's1', scoredCount: 1001 });
  });

  it('非 scope=all 破千：行為不變，照舊 400 TOO_MANY_ROWS', async () => {
    const tables = {
      ...BASE,
      academy_scores: Array.from({ length: 1001 }, (_, i) => academy(i + 1, 's1', '80')),
    };
    const { status, code } = await get(`?classId=${C1}`, { tables, maxRows: 1000 });
    expect(status).toBe(400);
    expect(code).toBe('TOO_MANY_ROWS');
  });
});
