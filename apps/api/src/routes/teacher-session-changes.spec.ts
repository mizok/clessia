import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import teacherChangesRoute, { TEACHER_CHANGES_SQL } from './teacher-session-changes';

/**
 * `GET /api/teacher/session-changes`（#1488）—— 老師只看得到自己任課班與代課課堂的異動。
 * 範圍由本人 staff.id 決定：連同時有 admin 角色的帳號也不能變全校。
 *
 * 查詢走一支 pg SQL（#1928 A#11）。這裡守**接線**：任期清單怎麼交給 SQL、回應怎麼組；
 * 可見範圍的語意（現任、前任只限任期、代課、別人的班、>200 堂）由
 * `contract/teacher-session-changes-1928.contract.ts` 與 `contract/teacher-tenure.contract.ts` 對真 DB 驗。
 */

const ORG = 'org-a';
const ME = 'staff-me';
const OTHER = 'staff-other';
const MY_CLASS = 'class-mine';
const PAST_CLASS = 'class-past';
const THEIR_CLASS = 'class-theirs';

const row = (id: string) => ({
  id,
  session_id: `s-${id}`,
  change_type: 'cancellation',
  operation_source: 'single',
  batch_id: null,
  reason: '颱風',
  created_by_name: '管理員甲',
  created_at: '2026-10-07T00:00:00+00:00',
  original_session_date: null,
  original_start_time: null,
  original_end_time: null,
  new_session_date: null,
  new_start_time: null,
  new_end_time: null,
  original_teacher_name: null,
  sessions: { session_date: '2026-10-07', classes: { name: '我的班' } },
  staff: null,
});

type Pool = { query: ReturnType<typeof vi.fn> };
const okPool = (): Pool => ({
  query: vi.fn().mockResolvedValue({ rows: [{ result: { total: 7, rows: [row('c1')] } }] }),
});

function app(opts: { roles?: string[]; staff?: boolean; pool?: Pool | null } = {}) {
  const db = createMultiOrgDb({
    staff: opts.staff === false ? [] : [{ id: ME, user_id: 'u1', org_id: ORG }],
    schedules: [
      {
        class_id: MY_CLASS,
        teacher_id: ME,
        effective_from: '2026-01-01',
        effective_to: null,
        classes: { org_id: ORG },
      },
      {
        class_id: PAST_CLASS,
        teacher_id: ME,
        effective_from: '2026-01-01',
        effective_to: '2026-03-31',
        classes: { org_id: ORG },
      },
      {
        class_id: PAST_CLASS,
        teacher_id: ME,
        effective_from: '2026-06-01',
        effective_to: '2026-06-30',
        classes: { org_id: ORG },
      },
      {
        class_id: THEIR_CLASS,
        teacher_id: OTHER,
        effective_from: '2026-01-01',
        effective_to: null,
        classes: { org_id: ORG },
      },
    ],
  });
  const pool = opts.pool === undefined ? okPool() : opts.pool;
  const hono = new Hono();
  hono.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'u1');
    set('roles', opts.roles ?? ['teacher']);
    if (pool) set('auth', { pool });
    await next();
  });
  hono.route('/', teacherChangesRoute as unknown as Hono);
  return { hono, pool };
}

const get = async (a: Hono, qs = 'from=2026-10-05&to=2026-10-11&page=2&pageSize=20') => {
  const res = await a.request(`/?${qs}`);
  const text = await res.text();
  return {
    res,
    body: (res.ok || res.status < 500 ? JSON.parse(text) : {}) as {
      data: { id: string; createdByName: unknown; className: unknown }[];
      meta: { total: number; page: number; pageSize: number };
    },
  };
};

describe('GET /api/teacher/session-changes', () => {
  it('任期清單交給 SQL：本人 staff、現任班、前任每一段（平行陣列）、區間、分頁', async () => {
    const { hono, pool } = app();
    await get(hono);
    expect(pool!.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool!.query.mock.calls[0]! as [string, unknown[]];
    expect(sql).toBe(TEACHER_CHANGES_SQL);
    expect(params).toEqual([
      ORG,
      '2026-10-05',
      '2026-10-11',
      ME,
      [MY_CLASS],
      [PAST_CLASS, PAST_CLASS],
      ['2026-01-01', '2026-06-01'],
      ['2026-03-31', '2026-06-30'],
      20,
      20,
    ]);
  });

  it('回應：照 describeChange 組、不給操作者姓名、總數從 SQL 來', async () => {
    const { body } = await get(app().hono);
    expect(body.data.map((r) => r.id)).toEqual(['c1']);
    expect(body.data[0]!.className).toBe('我的班');
    expect(body.data.every((r) => r.createdByName === null)).toBe(true);
    expect(body.meta).toEqual({ total: 7, page: 2, pageSize: 20 });
  });

  it('同時有 admin 角色也不會變全校（範圍看本人 staff.id）', async () => {
    const { hono, pool } = app({ roles: ['admin', 'teacher'] });
    await get(hono);
    expect((pool!.query.mock.calls[0]![1] as unknown[])[3]).toBe(ME);
  });

  it('沒有 pool → 500，不退回會 414 的 REST 寫法', async () => {
    const { res } = await get(app({ pool: null }).hono);
    expect(res.status).toBe(500);
  });

  it('SQL 拋錯 → 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pool = { query: vi.fn().mockRejectedValue(new Error('boom')) };
    const { res } = await get(app({ pool }).hono);
    expect(res.status).toBe(500);
  });

  it('沒有 staff 列 → 403，不查 SQL', async () => {
    const { hono, pool } = app({ staff: false });
    const { res } = await get(hono);
    expect(res.status).toBe(403);
    expect(pool!.query).not.toHaveBeenCalled();
  });

  it('區間倒置或超過 31 天 → 400', async () => {
    const { hono } = app();
    expect((await get(hono, 'from=2026-10-11&to=2026-10-05')).res.status).toBe(400);
    expect((await get(hono, 'from=2026-01-01&to=2026-10-05')).res.status).toBe(400);
  });
});
