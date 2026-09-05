import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import gradesRoute from './grades';

const CHILD_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_CHILD_ID = '00000000-0000-0000-0000-000000000002';

function chainable(resolve: () => { data: unknown; error: unknown; count?: number }) {
  const obj: any = {
    eq: () => obj,
    gte: () => obj,
    lte: () => obj,
    then: (onfulfilled: (value: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onfulfilled),
  };
  return obj;
}

const ACADEMY_ROW = {
  id: 'sc1',
  exam_id: 'ex1',
  student_id: CHILD_ID,
  score: 88,
  status: 'scored',
  created_at: '2026-09-01T08:00:00Z',
  academy_exams: {
    name: '單元小考',
    exam_date: '2026-09-01',
    total_score: 100,
    pass_score: 60,
    subjects: { name: '數學' },
  },
};

const SCHOOL_ROW = {
  id: 'sc2',
  school_exam_id: 'se1',
  student_id: CHILD_ID,
  score: 75,
  status: 'scored',
  created_at: '2026-08-20T09:00:00Z',
  school_exams: {
    label: '第一次段考',
    exam_date: '2026-08-20',
    created_at: '2026-08-20T00:00:00Z',
  },
  subjects: { name: '英文' },
};

/** 家長端一次只查單一學生 —— 這組假身用來確認「班級排名」根本沒有管道流進來：
 * 回應形狀裡沒有任何名次或全班分數欄位，因為查詢本身只回這一個學生的資料。 */
function fakeChildDb(
  academyRows: unknown[],
  schoolRows: unknown[],
  academyRecent: number,
  schoolRecent: number,
) {
  return {
    from: (table: string) => ({
      select: (_cols: string, opts?: { head?: boolean }) => {
        if (opts?.head) {
          const count = table === 'academy_scores' ? academyRecent : schoolRecent;
          return chainable(() => ({ data: null, error: null, count }));
        }
        const rows = table === 'academy_scores' ? academyRows : schoolRows;
        return chainable(() => ({ data: rows, error: null }));
      },
    }),
  };
}

function appWith(roles: string[], studentScope: readonly string[] | null, childDb: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', roles);
    set('studentScope', studentScope);
    set('childDb', childDb);
    await next();
  });
  app.route('/', gradesRoute as unknown as Hono);
  return app;
}

describe('GET /api/me/grades', () => {
  it('不是家長身分回 403', async () => {
    const res = await appWith(['admin'], [CHILD_ID], fakeChildDb([], [], 0, 0)).request(
      `/?childId=${CHILD_ID}`,
    );
    expect(res.status).toBe(403);
  });

  it('childId 不在 studentScope 裡回 403', async () => {
    const res = await appWith(
      ['parent'],
      [OTHER_CHILD_ID],
      fakeChildDb([ACADEMY_ROW], [], 1, 0),
    ).request(`/?childId=${CHILD_ID}`);
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'CHILD_OUT_OF_SCOPE' });
  });

  it('合併 academy 與 school 兩種成績，依考試日期新到舊排序，不含任何排名欄位', async () => {
    const res = await appWith(
      ['parent'],
      [CHILD_ID],
      fakeChildDb([ACADEMY_ROW], [SCHOOL_ROW], 1, 1),
    ).request(`/?childId=${CHILD_ID}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };

    expect(body.data).toHaveLength(2);
    // 2026-09-01（academy）比 2026-08-20（school）新，排在前面
    expect(body.data[0]).toMatchObject({
      type: 'academy',
      subjectName: '數學',
      score: 88,
      totalScore: 100,
      // 逐筆登錄時間，不是考試日期 —— 逐筆 NEW 標籤靠它，recentCount 指不出是哪幾筆
      createdAt: '2026-09-01T08:00:00Z',
      // 校內考才有及格線；#377 矛盾（家長端退化成比例、行政端用真門檻）就是靠這個欄位補上
      passScore: 60,
    });
    expect(body.data[1]).toMatchObject({
      type: 'school',
      subjectName: '英文',
      score: 75,
      totalScore: null,
      createdAt: '2026-08-20T09:00:00Z',
      // 段考沒有及格線這個欄位 —— 一律 null，前端該退化成比例算
      passScore: null,
    });
    // 不回 studentId / studentName —— 家長已經知道自己在看誰
    expect(body.data[0]).not.toHaveProperty('studentId');
    expect(body.data[0]).not.toHaveProperty('studentName');
    // recentCount 是兩張表獨立查詢加總，不靠當頁筆數
    expect(body.meta).toMatchObject({ total: 2, recentCount: 2 });
  });
});
