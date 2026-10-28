import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { STAFF_LIST_SQL, type StaffListSqlResult } from '../lib/staff-list-sql';
import staffApp from './staff';

/**
 * `GET /api/staff` 先走 SQL、失敗才走 builder（#1595 P2 第二刀）。這裡守**接線與退路、REST 支數**；
 * 兩條路結果逐欄相同由 `contract/staff-list.contract.ts` 對真 DB 驗。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const CA = '00000000-0000-0000-0000-0000000000ca';
const STAFF = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-0000000000a1';

afterEach(() => vi.restoreAllMocks());

const SQL_RESULT: StaffListSqlResult = {
  emptyByFilter: false,
  rows: [
    {
      id: STAFF,
      user_id: USER,
      org_id: ORG,
      display_name: 'SQL 回的老師',
      nickname: null,
      birthday: null,
      notes: null,
      status: 'active',
      created_at: '2026-10-01T00:00:00+00:00',
      updated_at: '2026-10-01T00:00:00+00:00',
    },
  ],
  total: 1,
  campusRows: [{ staff_id: STAFF, campus_id: CA }],
  subjectRows: [],
  roleRows: [{ user_id: USER, role: 'teacher', permissions: [] }],
  baUserRows: [{ id: USER, email: 't@example.test', phone: null, emailVerified: true }],
  summaryRows: [{ user_id: USER, status: 'active' }],
  summaryRoleRows: [{ user_id: USER, role: 'teacher', permissions: [] }],
};

/** 記錄 REST 支數的 supabase 替身：builder 那條會回一位名字不同的人 */
function restDouble() {
  let calls = 0;
  const b = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'in', 'or', 'ilike', 'order', 'range']) q[op] = () => q;
    q['then'] = (resolve: (v: unknown) => unknown) => resolve({ data: [], count: 0, error: null });
    return q;
  };
  return {
    client: {
      from: () => {
        calls++;
        return b();
      },
    },
    calls: () => calls,
  };
}

function appWith(pool: unknown, campusScope: readonly string[] | null = null) {
  const rest = restDouble();
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', rest.client);
    set('orgId', ORG);
    set('userId', 'user-1');
    set('roles', ['admin']);
    set('campusScope', campusScope);
    set('auth', pool === undefined ? undefined : { pool });
    await next();
  });
  app.route('/', staffApp as unknown as Hono);
  return { app, rest };
}

describe('GET /api/staff 先走 SQL（#1595 P2）', () => {
  it('有 pool：一次往返組完回應，**0 支 REST**（改前最壞 5 波 16 支）', async () => {
    const query = vi.fn(async () => ({ rows: [{ result: SQL_RESULT }] }));
    const { app, rest } = appWith({ query });

    const res = await app.request('/?role=teacher&search=老師');
    const body = (await res.json()) as {
      data: Array<{ displayName: string; campusIds: string[]; roles: string[]; email: string }>;
      summary: { teacherCount: number; byRole: Record<string, number> };
    };

    expect(res.status).toBe(200);
    expect(body.data[0]).toMatchObject({
      displayName: 'SQL 回的老師',
      campusIds: [CA],
      roles: ['teacher'],
      email: 't@example.test',
    });
    expect(body.summary.teacherCount).toBe(1);
    expect(body.summary.byRole).toEqual({ admin: 0, teacher: 1, kiosk: 0, inactiveOrArchived: 0 });
    expect(query).toHaveBeenCalledTimes(1);
    expect((query.mock.calls[0] as unknown[])[0]).toBe(STAFF_LIST_SQL);
    expect(rest.calls()).toBe(0);
  });

  it('SQL 拋錯：改走 builder，照樣回 200，記一行 [staff-sql]', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app, rest } = appWith({
      query: async () => {
        throw Object.assign(new Error('boom'), { code: 'XX000' });
      },
    });
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(rest.calls()).toBeGreaterThan(0);
    expect(log.mock.calls.some((c) => String(c[0]).includes('[staff-sql]'))).toBe(true);
  });

  it('篩選讓結果為空（emptyByFilter）：跟 builder 提早回的形狀一樣', async () => {
    const query = vi.fn(async () => ({
      rows: [{ result: { ...SQL_RESULT, emptyByFilter: true, rows: [], total: 0 } }],
    }));
    const res = await appWith({ query }).app.request('/?pageSize=0&page=3');
    expect(await res.json()).toMatchObject({
      data: [],
      meta: { total: 0, page: 3, pageSize: 0, totalPages: 0 },
    });
  });

  it('分校條件用 campusFilterIds 算：不受限 null、受限是範圍、沒被指派是空陣列', async () => {
    const query = vi.fn(async () => ({ rows: [{ result: SQL_RESULT }] }));
    await appWith({ query }, null).app.request('/');
    await appWith({ query }, [CA]).app.request('/');
    await appWith({ query }, []).app.request('/');
    expect(query.mock.calls.map((c) => (c as unknown[][])[1]![1])).toEqual([null, [CA], []]);
  });

  it('沒有 pool：走 builder', async () => {
    const { app, rest } = appWith(undefined);
    expect((await app.request('/')).status).toBe(200);
    expect(rest.calls()).toBeGreaterThan(0);
  });
});
