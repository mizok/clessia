import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { COURSE_LIST_SQL, type CourseListResult } from '../lib/course-list-sql';
import { createMultiOrgDb } from '../test-utils/multi-org-db';
import coursesApp from './courses';

/**
 * `GET /api/courses` 先走 SQL、失敗才走 builder（#1595 P2）。這裡守**接線與退路**；
 * 兩條路結果逐欄相同由 `contract/course-list.contract.ts` 對真 DB 驗。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const CA = '00000000-0000-0000-0000-0000000000ca';
const CB = '00000000-0000-0000-0000-0000000000cb';
const MATH = '00000000-0000-0000-0000-0000000000f1';
const COURSE = '00000000-0000-0000-0000-000000000001';

afterEach(() => vi.restoreAllMocks());

const SQL_RESULT: CourseListResult = {
  rows: [
    {
      id: COURSE,
      org_id: ORG,
      campus_id: CA,
      name: 'SQL 回的課',
      description: null,
      is_active: true,
      grade_levels: [],
      created_at: '2026-10-01T00:00:00+00:00',
      updated_at: '2026-10-01T00:00:00+00:00',
      subject_id: MATH,
      campuses: { name: 'A 校' },
      subjects: { name: '數學', sort_order: 1 },
    },
  ],
  total: 1,
  classCounts: { [COURSE]: { active: 2, ended: 1 } },
  bySubject: [{ subjectId: MATH, subjectName: '數學', count: 1 }],
};

/** builder 那條的資料：名字跟 SQL 的不同，看得出回應走哪條 */
const seed = () =>
  createMultiOrgDb({
    subjects: [{ id: MATH, org_id: ORG, name: '數學', sort_order: 1 }],
    courses: [
      {
        id: COURSE,
        org_id: ORG,
        campus_id: CA,
        subject_id: MATH,
        name: 'builder 回的課',
        is_active: true,
        created_at: '2026-10-01T00:00:00Z',
      },
    ],
    classes: [],
    campuses: [{ id: CA, org_id: ORG, name: 'A 校' }],
  });

async function list(
  path: string,
  { pool, scope = null }: { pool?: { query: ReturnType<typeof vi.fn> }; scope?: string[] | null },
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', seed().client);
    set('orgId', ORG);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', scope);
    if (pool) set('auth', { pool });
    await next();
  });
  app.route('/', coursesApp);
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const names = (body: Record<string, unknown>) =>
  (body['data'] as Array<{ name: string }>).map((c) => c.name);

describe('GET /api/courses 先走 SQL（#1595 P2）', () => {
  it('有 pool：用 SQL 的結果組回應（班數、章節、meta 都從 SQL 來）', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ result: SQL_RESULT }] }) };
    const { status, body } = await list('/?pageSize=20', { pool });
    expect(status).toBe(200);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0]![0]).toBe(COURSE_LIST_SQL);
    expect(names(body)).toEqual(['SQL 回的課']);
    expect(body['data']).toMatchObject([{ activeClassCount: 2, endedClassCount: 1 }]);
    expect(body['summary']).toEqual({ bySubject: SQL_RESULT.bySubject });
    expect(body['meta']).toEqual({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
  });

  it('SQL 拋錯：改走 builder，照樣回 200，記一行 [courses-sql]', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pool = {
      query: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: '53300' })),
    };
    const { status, body } = await list('/', { pool });
    expect(status).toBe(200);
    expect(names(body)).toEqual(['builder 回的課']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[courses-sql]'));
  });

  it.each([
    ['沒有列', []],
    ['total 不是數字', [{ result: { ...SQL_RESULT, total: '1' } }]],
    ['rows 不是陣列', [{ result: { ...SQL_RESULT, rows: null } }]],
    ['班數少了 ended', [{ result: { ...SQL_RESULT, classCounts: { [COURSE]: { active: 2 } } } }]],
    ['章節少了 count', [{ result: { ...SQL_RESULT, bySubject: [{ subjectId: MATH }] } }]],
  ])('SQL 結果形狀不對（%s）：不用猜的值，改走 builder', async (_label, rows) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pool = { query: vi.fn().mockResolvedValue({ rows }) };
    const { status, body } = await list('/', { pool });
    expect(status).toBe(200);
    expect(names(body)).toEqual(['builder 回的課']);
  });

  it('沒有 pool（沒經過 auth middleware 的精簡 app）：走 builder', async () => {
    const { body } = await list('/', {});
    expect(names(body)).toEqual(['builder 回的課']);
  });

  /** 參數順序見 COURSE_LIST_SQL 的註解：$2 課程分校、$9 班數分校 */
  const params = async (path: string, scope: string[] | null) => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ result: SQL_RESULT }] }) };
    await list(path, { pool, scope });
    return pool.query.mock.calls[0]![1] as unknown[];
  };

  it('分校條件用 campusFilterIds 算：不受限 null、受限是範圍；班數只吃範圍、不吃指定分校', async () => {
    expect((await params('/', null))[1]).toBeNull();
    expect((await params('/', null))[8]).toBeNull();
    // 不受限的管理員指定一間：課程吃那一間，班數照舊不篩（#1595 裁定 3：行為不變）
    const p = await params(`/?campusId=${CA}`, null);
    expect(p[1]).toEqual([CA]);
    expect(p[8]).toBeNull();
    // 受限者
    expect((await params('/', [CA]))[1]).toEqual([CA]);
    expect((await params('/', [CA]))[8]).toEqual([CA]);
  });

  it('沒被指派任何分校：傳空陣列（＝零筆，fail-closed），不是 null（＝不篩）', async () => {
    const p = await params('/', []);
    expect(p[1]).toEqual([]);
    expect(p[8]).toEqual([]);
  });

  it('篩選參數：空字串的 search 當成沒有、isActive 轉布林、不分頁時 limit 是 null', async () => {
    const p = await params('/?search=&isActive=false&pageSize=0', null);
    expect(p[2]).toBeNull();
    expect(p[3]).toBe(false);
    expect(p[5]).toBeNull();
    expect(p[6]).toBe(0);
    const q = await params(`/?search=數學&isActive=true&subjectId=${MATH}&page=3&pageSize=5`, [CB]);
    expect(q.slice(2, 7)).toEqual(['數學', true, MATH, 5, 10]);
  });
});
