import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import scoresApp from './scores';

/**
 * `GET /api/scores` 的分校範圍＋班級／課程篩選，與 `GET /api/scores/students` 每生聚合（#1115）。
 *
 * 替身記下每支查詢的條件，回傳依表名＋條件決定。**替身不實作 `in`／`eq`** ——
 * 範圍是否套上只能斷言「成績查詢帶了哪份學生／考試清單」；真的過濾要本機實打。
 */
interface Op {
  readonly name: string;
  readonly args: readonly unknown[];
}
interface RecordedQuery {
  readonly table: string;
  readonly ops: Op[];
}
type Resolver = (q: RecordedQuery) => { data?: unknown; count?: number | null } | undefined;

const has = (q: RecordedQuery, name: string, ...args: unknown[]) =>
  q.ops.some(
    (op) =>
      op.name === name && args.every((a, i) => JSON.stringify(op.args[i]) === JSON.stringify(a)),
  );
const inArg = (q: RecordedQuery, column: string) =>
  q.ops.find((op) => op.name === 'in' && op.args[0] === column)?.args[1];

function createApp(resolve: Resolver, campusScope: string[] | null) {
  const queries: RecordedQuery[] = [];
  const supabase = {
    from(table: string) {
      const recorded: RecordedQuery = { table, ops: [] };
      queries.push(recorded);
      const query: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === 'then') {
              return (onfulfilled?: (value: unknown) => unknown) =>
                Promise.resolve({ data: [], count: null, error: null, ...resolve(recorded) }).then(
                  onfulfilled,
                );
            }
            return (...args: unknown[]) => {
              recorded.ops.push({ name: prop, args });
              return query;
            };
          },
        },
      );
      return query;
    },
  };
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const ctx = c as unknown as { set: (k: string, v: unknown) => void };
    ctx.set('supabase', supabase);
    ctx.set('orgId', 'org-1');
    ctx.set('userId', 'user-1');
    ctx.set('roles', ['admin']);
    ctx.set('campusScope', campusScope);
    await next();
  });
  app.route('/api/scores', scoresApp);
  return { app, queries };
}

const CLASS = '11111111-1111-4111-8111-111111111111';
const COURSE = '22222222-2222-4222-8222-222222222222';
const STUDENT = '33333333-3333-4333-8333-333333333333';

const isCampusEnrollments = (q: RecordedQuery) =>
  q.table === 'enrollments' &&
  q.ops.some((op) => op.name === 'in' && op.args[0] === 'classes.campus_id');
const isClassEnrollments = (q: RecordedQuery) =>
  q.table === 'enrollments' && q.ops.some((op) => op.name === 'in' && op.args[0] === 'class_id');

interface Fixture {
  campusStudents?: string[];
  classStudents?: string[];
  examLinks?: string[];
  courseClasses?: string[];
  academy?: unknown[];
  school?: unknown[];
  academyCount?: number;
  classCampus?: string;
}

function resolver(f: Fixture): Resolver {
  return (q) => {
    if (isCampusEnrollments(q))
      return { data: (f.campusStudents ?? []).map((student_id) => ({ student_id })) };
    if (isClassEnrollments(q))
      return { data: (f.classStudents ?? []).map((student_id) => ({ student_id })) };
    if (q.table === 'academy_exam_classes')
      return { data: (f.examLinks ?? []).map((exam_id) => ({ exam_id })) };
    if (q.table === 'classes' && f.classCampus)
      return { data: { id: 'c', campus_id: f.classCampus } };
    if (q.table === 'classes') return { data: (f.courseClasses ?? []).map((id) => ({ id })) };
    if (q.table === 'students') return { data: { id: STUDENT, name: '王小明', school_id: null } };
    if (q.table === 'academy_scores') {
      return { data: f.academy ?? [], count: f.academyCount ?? (f.academy ?? []).length };
    }
    if (q.table === 'school_scores')
      return { data: f.school ?? [], count: (f.school ?? []).length };
    return { data: [] };
  };
}

const scoreQueries = (queries: RecordedQuery[]) =>
  queries.filter((q) => q.table === 'academy_scores' || q.table === 'school_scores');

describe('GET /api/scores —— 分校範圍（#1115）', () => {
  it('受限管理員：成績查詢只帶範圍內學生（任一報名在範圍內就算）', async () => {
    const { app, queries } = createApp(resolver({ campusStudents: ['s1', 's2', 's1'] }), [
      'campus-1',
    ]);
    const res = await app.request('/api/scores');
    expect(res.status).toBe(200);
    const campusQuery = queries.find(isCampusEnrollments)!;
    expect(inArg(campusQuery, 'classes.campus_id')).toEqual(['campus-1']);
    const scores = scoreQueries(queries);
    expect(scores.map((q) => q.table).sort()).toEqual(['academy_scores', 'school_scores']);
    for (const q of scores) expect(inArg(q, 'student_id')).toEqual(['s1', 's2']);
  });

  it('沒被指派分校（空陣列）→ 空結果，不查成績', async () => {
    const { app, queries } = createApp(resolver({}), []);
    const res = await app.request('/api/scores');
    expect(((await res.json()) as { meta: { total: number } }).meta.total).toBe(0);
    expect(scoreQueries(queries)).toHaveLength(0);
  });

  it('不受限的管理員：不查報名、成績查詢不帶學生清單', async () => {
    const { app, queries } = createApp(resolver({}), null);
    await app.request('/api/scores');
    expect(queries.some((q) => q.table === 'enrollments')).toBe(false);
    for (const q of scoreQueries(queries)) expect(inArg(q, 'student_id')).toBeUndefined();
  });
});

describe('GET /api/scores —— classId／courseId（#1115）', () => {
  it('篩班：校內考要「掛在這班 ∧ 學生在這班」，段考照學生在這班；跟分校範圍取交集', async () => {
    const { app, queries } = createApp(
      resolver({
        campusStudents: ['s1', 's2'],
        classStudents: ['s2', 's3'],
        examLinks: ['e1', 'e2'],
      }),
      ['campus-1'],
    );
    await app.request(`/api/scores?classId=${CLASS}`);
    const academy = queries.find((q) => q.table === 'academy_scores')!;
    const school = queries.find((q) => q.table === 'school_scores')!;
    expect(inArg(academy, 'exam_id')).toEqual(['e1', 'e2']);
    expect(inArg(academy, 'student_id')).toEqual(['s2']);
    expect(inArg(school, 'student_id')).toEqual(['s2']);
    expect(inArg(school, 'exam_id')).toBeUndefined();
  });

  it('courseId 展開成它的開課班', async () => {
    const { app, queries } = createApp(
      resolver({ courseClasses: ['c1', 'c2'], classStudents: ['s1'], examLinks: ['e1'] }),
      null,
    );
    await app.request(`/api/scores?courseId=${COURSE}`);
    expect(
      has(
        queries.find((q) => q.table === 'classes')!,
        'eq',
        'course_id',
        COURSE,
      ),
    ).toBe(true);
    expect(inArg(queries.find(isClassEnrollments)!, 'class_id')).toEqual(['c1', 'c2']);
    expect(
      inArg(
        queries.find((q) => q.table === 'academy_exam_classes')!,
        'class_id',
      ),
    ).toEqual(['c1', 'c2']);
  });

  it('班上沒掛任何校內考 → 不查校內考，段考照查', async () => {
    const { app, queries } = createApp(resolver({ classStudents: ['s1'], examLinks: [] }), null);
    await app.request(`/api/scores?classId=${CLASS}`);
    expect(scoreQueries(queries).map((q) => q.table)).toEqual(['school_scores']);
  });
});

const academyRow = (
  student: string,
  name: string,
  score: number | null,
  total: number,
  status = 'scored',
  date = '2026-09-01',
) => ({
  id: `a-${student}-${score}-${status}`,
  student_id: student,
  score,
  status,
  created_at: '2026-09-01T00:00:00Z',
  academy_exams: {
    name: '小考',
    exam_date: date,
    total_score: total,
    pass_score: 60,
    scope_note: null,
    subjects: { name: '數學' },
  },
  students: { name },
});
const schoolRow = (
  student: string,
  name: string,
  score: number,
  examDate: string | null,
  createdAt = '2026-08-01T00:00:00Z',
) => ({
  id: `s-${student}-${score}`,
  student_id: student,
  score,
  status: 'scored',
  created_at: createdAt,
  school_exams: { label: '段考', exam_date: examDate, created_at: createdAt },
  subjects: { name: '英文' },
  students: { name },
});

describe('GET /api/scores/students —— 每生聚合（#1115）', () => {
  it('沒帶 classId／courseId／studentId → 400 SCOPE_REQUIRED，不查', async () => {
    const { app, queries } = createApp(resolver({}), null);
    const res = await app.request('/api/scores/students');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('SCOPE_REQUIRED');
    expect(queries).toHaveLength(0);
  });

  it('每生一列：校內考總得分／總滿分、段考平均、三種計數、最新考試日；依姓名排序', async () => {
    const { app } = createApp(
      resolver({
        classStudents: ['u1', 'u2'],
        examLinks: ['e1'],
        academy: [
          academyRow('u1', '王小明', 80, 100),
          academyRow('u1', '王小明', 45, 50, 'scored', '2026-09-10'),
          academyRow('u1', '王小明', null, 100, 'absent'),
          academyRow('u2', '李小華', null, 100, 'makeup'),
        ],
        school: [schoolRow('u1', '王小明', 90, '2026-08-20'), schoolRow('u1', '王小明', 70, null)],
      }),
      null,
    );
    const res = await app.request(`/api/scores/students?classId=${CLASS}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
      meta: { total: number };
    };
    expect(body.meta.total).toBe(2);
    // zh-Hant 依筆畫排：王（4 畫）在李（7 畫）前面
    expect(body.data.map((r) => r['studentName'])).toEqual(['王小明', '李小華']);
    expect(body.data[0]).toEqual({
      studentId: 'u1',
      studentName: '王小明',
      academySum: 125,
      academyTotalSum: 150,
      schoolAvg: 80,
      scoredCount: 4,
      absentCount: 1,
      makeupCount: 0,
      latestExamDate: '2026-09-10',
    });
    expect(body.data[1]).toMatchObject({
      academySum: null,
      schoolAvg: null,
      makeupCount: 1,
      scoredCount: 0,
    });
  });

  it('段考照回應的 examDate 篩（沒填考試日期的退回建立日）；search 篩學生姓名', async () => {
    const { app } = createApp(
      resolver({
        classStudents: ['u1', 'u2'],
        examLinks: [],
        school: [
          schoolRow('u1', '王小明', 90, '2026-08-20'),
          schoolRow('u1', '王小明', 70, null, '2026-09-15T00:00:00Z'),
          schoolRow('u2', '李小華', 60, '2026-09-20'),
        ],
      }),
      null,
    );
    const res = await app.request(
      `/api/scores/students?classId=${CLASS}&dateFrom=2026-09-01&search=${encodeURIComponent('小明')}`,
    );
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      studentName: '王小明',
      schoolAvg: 70,
      latestExamDate: '2026-09-15',
    });
  });

  it('實際筆數比撈回來的多（max_rows 截斷）→ 400 TOO_MANY_ROWS，不回錯的數字', async () => {
    const { app } = createApp(
      resolver({
        classStudents: ['u1'],
        examLinks: ['e1'],
        academy: [academyRow('u1', '王小明', 80, 100)],
        academyCount: 1500,
      }),
      null,
    );
    const res = await app.request(`/api/scores/students?classId=${CLASS}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('TOO_MANY_ROWS');
  });

  it('受限管理員：聚合的成績查詢也只帶範圍內學生', async () => {
    const { app, queries } = createApp(
      resolver({ campusStudents: ['u1'], classStudents: ['u1', 'u9'], examLinks: ['e1'] }),
      ['campus-1'],
    );
    await app.request(`/api/scores/students?studentId=${STUDENT}&classId=${CLASS}`);
    for (const q of scoreQueries(queries)) expect(inArg(q, 'student_id')).toEqual(['u1']);
  });
});

describe('summary／class-exam 的分校範圍（#1250）', () => {
  const EXAM = '44444444-4444-4444-8444-444444444444';

  it.each([
    ['學生摘要', `/api/scores/student/${STUDENT}/summary`, {}],
    ['班級考試統計', `/api/scores/class/${CLASS}/exam/${EXAM}`, { classCampus: 'campus-2' }],
  ] as const)('%s：別校 → 403 FORBIDDEN', async (_n, path, extra) => {
    const { app } = createApp(resolver({ campusStudents: [], ...extra }), ['campus-1']);
    const res = await app.request(path);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  it.each([
    [
      '學生摘要（同校）',
      `/api/scores/student/${STUDENT}/summary`,
      { campusStudents: [STUDENT] },
      ['campus-1'],
    ],
    ['學生摘要（不受限）', `/api/scores/student/${STUDENT}/summary`, {}, null],
    [
      '班級考試統計（同校）',
      `/api/scores/class/${CLASS}/exam/${EXAM}`,
      { classCampus: 'campus-1' },
      ['campus-1'],
    ],
    [
      '班級考試統計（不受限）',
      `/api/scores/class/${CLASS}/exam/${EXAM}`,
      { classCampus: 'campus-2' },
      null,
    ],
  ] as const)('%s：不被分校擋', async (_n, path, extra, scope) => {
    const { app } = createApp(resolver(extra as Fixture), scope as string[] | null);
    const res = await app.request(path);
    expect(res.status).not.toBe(403);
  });
});

describe('GET /api/scores 列表 —— #1253', () => {
  // 替身照 PostgREST 的行為：沒帶 range 最多回 1000 列（max_rows），帶了 range 就照區間切
  const pagedResolver =
    (academy: unknown[], school: unknown[]): Resolver =>
    (q) => {
      const all =
        q.table === 'academy_scores' ? academy : q.table === 'school_scores' ? school : null;
      if (!all) return { data: [] };
      const range = q.ops.find((op) => op.name === 'range')?.args as [number, number] | undefined;
      const data = range ? all.slice(range[0], range[1] + 1) : all.slice(0, 1000);
      return { data, count: all.length };
    };

  it('段考也吃 dateFrom／dateTo（照回應的 examDate；沒填考試日期的退回建立日，同 #1167）', async () => {
    const { app } = createApp(
      pagedResolver(
        [],
        [
          schoolRow('u1', '王小明', 90, '2026-08-20'),
          schoolRow('u1', '王小明', 70, null, '2026-09-15T00:00:00Z'),
          schoolRow('u2', '李小華', 60, '2026-10-20'),
        ],
      ),
      null,
    );
    const res = await app.request('/api/scores?type=school&dateFrom=2026-09-01&dateTo=2026-09-30');
    const body = (await res.json()) as {
      data: Array<{ examDate: string }>;
      meta: { total: number };
    };
    expect(body.data.map((d) => d.examDate)).toEqual(['2026-09-15']);
    expect(body.meta.total).toBe(1);
  });

  it('超過 1000 列時不被靜默截斷：第 1001 列之後的頁照樣拿得到', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      ...academyRow('u1', '王小明', i, 100),
      id: `a-${i}`,
    }));
    const { app } = createApp(pagedResolver(rows, []), null);
    const res = await app.request('/api/scores?type=academy&page=6&pageSize=200');
    const body = (await res.json()) as { data: unknown[]; meta: { total: number } };
    expect(body.meta.total).toBe(1500);
    expect(body.data).toHaveLength(200);
  });
});
