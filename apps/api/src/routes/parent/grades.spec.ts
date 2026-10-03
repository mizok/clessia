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
    order: () => obj,
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
    scope_note: '第三章 一元二次方程式',
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
  periods: unknown[] = [],
) {
  return {
    orgRef: (table: string) => ({
      select: () => {
        if (table !== 'billing_periods') throw new Error(`unexpected orgRef(${table})`);
        return chainable(() => ({ data: periods, error: null }));
      },
    }),
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
      // #1076：展開詳情顯示的考試描述＝校內考的範圍說明（scope_note）
      description: '第三章 一元二次方程式',
    });
    expect(body.data[1]).toMatchObject({
      type: 'school',
      subjectName: '英文',
      score: 75,
      totalScore: null,
      createdAt: '2026-08-20T09:00:00Z',
      // 段考沒有及格線這個欄位 —— 一律 null，前端該退化成比例算
      passScore: null,
      // 段考沒有描述欄位（school_exams 只有 label）
      description: null,
    });
    // 不回 studentId / studentName —— 家長已經知道自己在看誰
    expect(body.data[0]).not.toHaveProperty('studentId');
    expect(body.data[0]).not.toHaveProperty('studentName');
    // recentCount 是兩張表獨立查詢加總，不靠當頁筆數
    expect(body.meta).toMatchObject({ total: 2, recentCount: 2 });
  });

  it('meta.periods 回機構的期（billing_periods），前端用它判考試落在哪個期（#1076）', async () => {
    const res = await appWith(
      ['parent'],
      [CHILD_ID],
      fakeChildDb([ACADEMY_ROW], [], 0, 0, [
        { id: 'p2', name: '115 上學期', start_date: '2026-08-01', end_date: '2027-01-31' },
        { id: 'p1', name: '114 下學期', start_date: '2026-02-01', end_date: '2026-07-31' },
      ]),
    ).request(`/?childId=${CHILD_ID}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: { periods: unknown[] } };
    expect(body.meta.periods).toEqual([
      { id: 'p2', name: '115 上學期', startDate: '2026-08-01', endDate: '2027-01-31' },
      { id: 'p1', name: '114 下學期', startDate: '2026-02-01', endDate: '2026-07-31' },
    ]);
  });
});

// #1167：dateFrom/dateTo 原本只套在校內考的查詢上，段考整批不篩
describe('GET /api/me/grades —— dateFrom/dateTo 兩種成績都篩（#1167）', () => {
  const NO_DATE_SCHOOL_ROW = {
    ...SCHOOL_ROW,
    id: 'sc3',
    // 段考沒填考試日期時，畫面顯示的是建立日（mapSchoolScoreRow 的退路）—— 篩選要照同一個日期
    school_exams: { label: '模擬考', exam_date: null, created_at: '2026-09-10T00:00:00Z' },
  };
  const ids = async (query: string) => {
    const res = await appWith(
      ['parent'],
      [CHILD_ID],
      fakeChildDb([ACADEMY_ROW], [SCHOOL_ROW, NO_DATE_SCHOOL_ROW], 0, 0),
    ).request(`/?childId=${CHILD_ID}${query}`);
    const body = (await res.json()) as { data: Array<{ id: string }>; meta: { total: number } };
    return { ids: body.data.map((d) => d.id), total: body.meta.total };
  };

  it('dateFrom 擋掉之前的段考', async () => {
    expect(await ids('&dateFrom=2026-08-25')).toEqual({ ids: ['sc3', 'sc1'], total: 2 });
  });

  it('dateTo 擋掉之後的段考與校內考', async () => {
    expect(await ids('&dateTo=2026-08-25')).toEqual({ ids: ['sc2'], total: 1 });
  });

  it('沒填考試日期的段考照建立日篩（跟畫面上顯示的日期一致）', async () => {
    expect(await ids('&dateFrom=2026-09-05&dateTo=2026-09-30')).toEqual({ ids: ['sc3'], total: 1 });
  });
});
