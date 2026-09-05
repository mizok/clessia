// TODO(exam-redesign): 測試覆蓋率不完整，close/reopen, candidate list, recent-students 等行為
//                     待後續加入 e2e 或更完整的 Supabase mock 後補齊。
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import scoresApp, { sumPairsOrNull } from './scores';

describe('sumPairsOrNull', () => {
  it('沒有紀錄回 null，不是 0（沒登錄過跟登錄了 0 分不一樣）', () => {
    expect(sumPairsOrNull([])).toBeNull();
  });

  // 這是這條規則存在的理由：不同總分的小考平均起來沒有意義，
  // 「總得分/總滿分」才是看得懂的數字
  it('累加分數與總分，不做除法', () => {
    expect(
      sumPairsOrNull([
        { score: 60, totalScore: 100 },
        { score: 70, totalScore: 50 },
      ]),
    ).toEqual({ sum: 130, totalSum: 150 });
  });

  it('單筆紀錄照樣是那筆的分數與總分', () => {
    expect(sumPairsOrNull([{ score: 45, totalScore: 60 }])).toEqual({ sum: 45, totalSum: 60 });
  });
});

interface ScoresState {
  students: Array<{ id: string; org_id: string; name: string }>;
  subjects: Array<{ id: string; name: string }>;
  academy_exams: Array<{
    id: string;
    org_id: string;
    name: string;
    exam_date: string;
    subject_id: string;
    total_score: number;
  }>;
  academy_scores: Array<{
    id: string;
    exam_id: string;
    student_id: string;
    score: number | null;
    status: 'scored' | 'absent' | 'makeup';
  }>;
}

function createTestApp(state: ScoresState) {
  const app = new Hono();
  app.use('/api/scores/*', async (c, next) => {
    (c as any).set('supabase', createSupabase(state));
    (c as any).set('orgId', 'org-1');
    // 這一組測的是搜尋比對，用管理員身分跑 —— 老師身分會走 teacher-scope 的
    // staff 查詢，那不是這條測試的主題（範圍限制另有 exam-scope 的測試守）
    (c as any).set('roles', ['admin']);
    (c as any).set('userId', 'u1');
    await next();
  });
  app.route('/api/scores', scoresApp);
  return app;
}

function createSupabase(state: ScoresState) {
  return {
    from(table: string) {
      if (table === 'students') return createStudentsQuery(state);
      if (table === 'academy_exams') return createAcademyExamsQuery(state);
      if (table === 'academy_scores') return createAcademyScoresQuery(state);
      if (table === 'school_scores') return createEmptySchoolScoresQuery();
      throw new Error(`Unsupported table: ${table}`);
    },
  };
}

function createStudentsQuery(state: ScoresState) {
  const filters: Array<{ type: 'eq' | 'ilike'; col: string; value: unknown }> = [];
  const query = {
    select() {
      return query;
    },
    eq(col: string, value: unknown) {
      filters.push({ type: 'eq', col, value });
      return query;
    },
    ilike(col: string, value: unknown) {
      filters.push({ type: 'ilike', col, value });
      return query;
    },
    then(onfulfilled?: ((value: { data: unknown[]; error: null }) => unknown) | null) {
      const rows = state.students
        .filter((s) =>
          filters.every((f) => {
            if (f.type === 'eq') return (s as Record<string, unknown>)[f.col] === f.value;
            const keyword = String(f.value).replace(/%/g, '').toLowerCase();
            return String((s as Record<string, unknown>)[f.col] ?? '')
              .toLowerCase()
              .includes(keyword);
          }),
        )
        .map((s) => ({ id: s.id, name: s.name }));
      return Promise.resolve({ data: rows, error: null }).then(onfulfilled ?? undefined);
    },
  };
  return query;
}

function createAcademyExamsQuery(state: ScoresState) {
  const filters: Array<{ type: 'eq' | 'ilike'; col: string; value: unknown }> = [];
  const query = {
    select() {
      return query;
    },
    eq(col: string, value: unknown) {
      filters.push({ type: 'eq', col, value });
      return query;
    },
    ilike(col: string, value: unknown) {
      filters.push({ type: 'ilike', col, value });
      return query;
    },
    gte() {
      return query;
    },
    lte() {
      return query;
    },
    then(onfulfilled?: ((value: { data: unknown[]; error: null }) => unknown) | null) {
      const rows = state.academy_exams
        .filter((e) =>
          filters.every((f) => {
            if (f.type === 'eq') return (e as Record<string, unknown>)[f.col] === f.value;
            const keyword = String(f.value).replace(/%/g, '').toLowerCase();
            return String((e as Record<string, unknown>)[f.col] ?? '')
              .toLowerCase()
              .includes(keyword);
          }),
        )
        .map((e) => ({ id: e.id }));
      return Promise.resolve({ data: rows, error: null }).then(onfulfilled ?? undefined);
    },
  };
  return query;
}

function createAcademyScoresQuery(state: ScoresState) {
  const filters: Array<{ type: 'eq' | 'in'; col: string; value: unknown }> = [];
  const query = {
    select() {
      return query;
    },
    eq(col: string, value: unknown) {
      filters.push({ type: 'eq', col, value });
      return query;
    },
    in(col: string, value: unknown[]) {
      filters.push({ type: 'in', col, value });
      return query;
    },
    gte() {
      return query;
    },
    lte() {
      return query;
    },
    order() {
      return query;
    },
    then(
      onfulfilled?: ((value: { data: unknown[]; error: null; count: number }) => unknown) | null,
    ) {
      const rows = state.academy_scores
        .filter((score) =>
          filters.every((f) => {
            if (f.col === 'academy_exams.org_id') {
              const exam = state.academy_exams.find((e) => e.id === score.exam_id);
              return exam?.org_id === f.value;
            }
            if (f.type === 'eq') return (score as Record<string, unknown>)[f.col] === f.value;
            return (f.value as unknown[]).includes((score as Record<string, unknown>)[f.col]);
          }),
        )
        .map((score) => {
          const exam = state.academy_exams.find((e) => e.id === score.exam_id)!;
          const student = state.students.find((s) => s.id === score.student_id)!;
          const subject = state.subjects.find((s) => s.id === exam.subject_id);
          return {
            id: score.id,
            exam_id: score.exam_id,
            student_id: score.student_id,
            score: score.score,
            status: score.status,
            academy_exams: {
              name: exam.name,
              exam_date: exam.exam_date,
              total_score: exam.total_score,
              org_id: exam.org_id,
              subject_id: exam.subject_id,
              subjects: subject ? { name: subject.name } : null,
            },
            students: { name: student.name },
          };
        });
      return Promise.resolve({ data: rows, error: null, count: rows.length }).then(
        onfulfilled ?? undefined,
      );
    },
  };
  return query;
}

function createEmptySchoolScoresQuery() {
  return {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    then(
      onfulfilled?: ((value: { data: unknown[]; error: null; count: number }) => unknown) | null,
    ) {
      return Promise.resolve({ data: [], error: null, count: 0 }).then(onfulfilled ?? undefined);
    },
  };
}

describe('scores partial coverage', () => {
  it('search can match academy exam name', async () => {
    const app = createTestApp({
      students: [{ id: 's1', org_id: 'org-1', name: '王小明' }],
      subjects: [{ id: 'sub-1', name: '數學' }],
      academy_exams: [
        {
          id: 'ae1',
          org_id: 'org-1',
          name: '期中衝刺考',
          exam_date: '2026-04-11',
          subject_id: 'sub-1',
          total_score: 100,
        },
      ],
      academy_scores: [
        { id: 'as1', exam_id: 'ae1', student_id: 's1', score: 90, status: 'scored' },
      ],
    });

    const res = await app.request('/api/scores?type=academy&search=衝刺考');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ examName: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].examName).toBe('期中衝刺考');
  });
});
