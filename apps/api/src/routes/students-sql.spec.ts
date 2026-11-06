import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { STUDENT_LIST_SQL, type StudentListResult } from '../lib/student-list-sql';
import { TEACHER_ROSTER_SQL } from '../lib/teacher-roster-sql';
import { createMultiOrgDb } from '../test-utils/multi-org-db';
import studentsRoute from './students';

/**
 * `GET /api/students` 有 pool 就走 SQL、失敗回 500 不退回（#1595 P2 ② 刀 1a、#2230 (c)）；沒有 pool、
 * 才走 builder。這裡守**接線**；兩條路逐欄相同由
 * `contract/student-list-sql.contract.ts` 對真 DB 驗。
 */

const ORG = 'org-a';
const CA = '00000000-0000-0000-0000-0000000000ca';

afterEach(() => vi.restoreAllMocks());

const SQL_RESULT: StudentListResult = {
  rows: [
    {
      id: 's-sql',
      org_id: ORG,
      name: 'SQL 回的學生',
      grade: 'J2',
      is_active: true,
      created_at: '2026-10-01T00:00:00+00:00',
      updated_at: '2026-10-01T00:00:00+00:00',
      schools: null,
      parent_student_relations: [
        {
          is_primary: true,
          relation: '父',
          parents: { id: 'p1', name: '爸', user_id: 'u1', phone: '0912000001' },
        },
      ],
      enrollments: [],
      active_card: [{ id: 'k1' }],
    },
  ],
  total: 21,
  activeCount: 7,
  byGrade: { J2: 3, P1: 1 },
};

const seed = () =>
  createMultiOrgDb({
    students: [{ id: 's-b', org_id: ORG, name: 'builder 回的學生', grade: 'J1', is_active: true }],
    schools: [],
    enrollments: [],
    parent_student_relations: [],
  });

async function list(
  path: string,
  {
    pool,
    scope = null,
    teacher = false,
  }: { pool?: { query: ReturnType<typeof vi.fn> }; scope?: string[] | null; teacher?: boolean },
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', seed().client);
    set('orgId', ORG);
    set('userId', 'admin-a');
    set('roles', [teacher ? 'teacher' : 'admin']);
    set('permissions', teacher ? [] : ['*']);
    set('campusScope', scope);
    if (pool) set('auth', { pool });
    await next();
  });
  app.route('/', studentsRoute);
  const res = await app.request(path);
  const text = await res.text();
  return {
    status: res.status,
    text,
    body: (res.ok ? JSON.parse(text) : {}) as Record<string, unknown>,
  };
}

const names = (body: Record<string, unknown>) =>
  (body['data'] as Array<{ name: string }>).map((s) => s.name);
const okPool = () => ({ query: vi.fn().mockResolvedValue({ rows: [{ result: SQL_RESULT }] }) });

describe('GET /api/students 先走 SQL（#1595 P2 ② 刀 1a）', () => {
  it('有 pool：列表、總數、在籍數、章節、主要家長電話都從 SQL 來', async () => {
    const pool = okPool();
    const { status, body } = await list('/?withToday=false&pageSize=20', { pool });
    expect(status).toBe(200);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0]![0]).toBe(STUDENT_LIST_SQL);
    expect(names(body)).toEqual(['SQL 回的學生']);
    expect(body['data']).toMatchObject([
      { primaryParentPhone: '0912000001', hasActiveCard: true, parentNames: ['爸'] },
    ]);
    const summary = body['summary'] as { total: number; activeCount: number; byGrade: unknown[] };
    expect(summary.total).toBe(21);
    expect(summary.activeCount).toBe(7);
    expect(summary.byGrade).toContainEqual({ grade: 'J2', count: 3 });
    expect(summary.byGrade).toContainEqual({ grade: 'S3', count: 0 });
    expect(body['meta']).toEqual({ total: 21, page: 1, pageSize: 20, totalPages: 2 });
  });

  it('SQL 拋錯 → 500，不退回 builder，記一行 [students-sql]', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pool = {
      query: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: '53300' })),
    };
    const { status, text } = await list('/?withToday=false', { pool });
    expect(status).toBe(500);
    expect(text).not.toContain('builder 回的學生');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[students-sql]'));
  });

  it.each([
    ['沒有列', []],
    ['total 不是數字', [{ result: { ...SQL_RESULT, total: '1' } }]],
    ['activeCount 少了', [{ result: { ...SQL_RESULT, activeCount: undefined } }]],
    ['rows 不是陣列', [{ result: { ...SQL_RESULT, rows: null } }]],
    ['章節計數不是數字', [{ result: { ...SQL_RESULT, byGrade: { J2: null } } }]],
  ])('SQL 結果形狀不對（%s）→ 500，不退回 builder', async (_label, rows) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pool = { query: vi.fn().mockResolvedValue({ rows }) };
    const { status, text } = await list('/?withToday=false', { pool });
    expect(status).toBe(500);
    expect(text).not.toContain('builder 回的學生');
  });

  it('沒有 pool：走 builder', async () => {
    expect(names((await list('/?withToday=false', {})).body)).toEqual(['builder 回的學生']);
  });

  it('搜尋與今日 id 也走 SQL（刀 1b）：預設範圍比家長／學校、3 碼以上數字比電話，不碰 builder 的前置查詢', async () => {
    const p = await params(`/?withToday=false&search=${encodeURIComponent('王')}`, null);
    expect(p.slice(13, 17)).toEqual(['王', true, false, null]);
    const q = await params('/?withToday=false&search=0912&searchScope=student_name', null);
    expect(p.length).toBe(17);
    expect(q.slice(13, 16)).toEqual(['0912', false, true]);
    // 空字串當成沒有（同 builder 的 `if (search)`）
    expect((await params('/?withToday=false&search=', null))[13]).toBeNull();
  });

  /** 參數順序見 STUDENT_LIST_SQL 的註解 */
  const params = async (path: string, scope: string[] | null) => {
    const pool = okPool();
    await list(path, { pool, scope });
    return pool.query.mock.calls[0]![1] as unknown[];
  };

  it('分校條件用 campusFilterIds 算：不受限 null、受限是範圍、沒指派是空陣列（fail-closed）', async () => {
    expect((await params('/?withToday=false', null))[1]).toBeNull();
    expect((await params(`/?withToday=false&campusId=${CA}`, null))[1]).toEqual([CA]);
    expect((await params('/?withToday=false', [CA]))[1]).toEqual([CA]);
    expect((await params('/?withToday=false', []))[1]).toEqual([]);
    // 管理員沒有老師範圍；管理員帶電話
    const p = await params('/?withToday=false', null);
    expect(p[2]).toBeNull();
    expect(p[12]).toBe(true);
  });

  it('篩選與分頁參數', async () => {
    const p = await params(
      '/?withToday=false&grade=J2&isActive=true&schoolMismatch=true&withoutCard=true&cardIssuedToday=true&page=3&pageSize=5',
      null,
    );
    expect(p.slice(3, 8)).toEqual(['J2', true, true, true, true]);
    expect(p[8]).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\+08:00$/);
    expect(p[9]).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\+08:00$/);
    expect(p.slice(10, 12)).toEqual([5, 10]);
    const d = await params('/?withToday=false', null);
    expect(d.slice(3, 8)).toEqual([null, null, false, false, false]);
  });

  // #2313：z.coerce.boolean() 把字串 "false" 讀成 true，?isActive=false 篩成在籍
  it('isActive=false 是 false（不是在籍）；taughtByMe=false 解析得過', async () => {
    expect((await params('/?withToday=false&isActive=false', null))[4]).toBe(false);
    expect((await params('/?withToday=false&isActive=0', null))[4]).toBe(false);
    expect((await params('/?withToday=false&isActive=1&taughtByMe=false', null))[4]).toBe(true);
    expect((await list('/?withToday=false&isActive=yes', {})).status).toBe(400);
  });

  it('老師（刀 2）：先一支老師範圍 SQL，現任班才算（前任不算）、在籍學生只取現任班', async () => {
    const pool = {
      query: vi.fn().mockImplementation(async (sql: string) =>
        sql === TEACHER_ROSTER_SQL
          ? {
              rows: [
                {
                  result: {
                    staffId: 'staff-t',
                    schedules: [
                      { class_id: 'k-now', effective_from: '2026-01-01', effective_to: null },
                      {
                        class_id: 'k-old',
                        effective_from: '2025-01-01',
                        effective_to: '2025-06-30',
                      },
                    ],
                    enrollments: [
                      { student_id: 's1', class_id: 'k-now' },
                      { student_id: 's2', class_id: 'k-old' },
                    ],
                  },
                },
              ],
            }
          : { rows: [{ result: SQL_RESULT }] },
      ),
    };
    const { status } = await list('/?withToday=false', { pool, teacher: true });
    expect(status).toBe(200);
    expect(pool.query.mock.calls[0]![1]).toEqual([ORG, 'admin-a']);
    const listParams = pool.query.mock.calls[1]![1] as unknown[];
    expect(listParams[2]).toEqual(['k-now']);
    expect(listParams[12]).toBe(false); // 老師不帶電話
  });

  it('老師範圍 SQL 失敗 → 500，不退回 REST', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pool = { query: vi.fn().mockRejectedValue(new Error('x')) };
    expect((await list('/?withToday=false', { pool, teacher: true })).status).toBe(500);
  });

  it('老師沒有 staff 列 → 403（同 REST 那條）', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ result: { staffId: null, schedules: [], enrollments: [] } }],
      }),
    };
    expect((await list('/?withToday=false', { pool, teacher: true })).status).toBe(403);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
