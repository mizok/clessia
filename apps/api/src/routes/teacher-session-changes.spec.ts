import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import teacherChangesRoute from './teacher-session-changes';

/**
 * `GET /api/teacher/session-changes`（#1488）—— 老師只看得到自己任課班與代課課堂的異動。
 * 範圍由本人 staff.id 決定：連同時有 admin 角色的帳號也不能變全校。
 */

const ORG = 'org-a';
const ME = 'staff-me';
const OTHER = 'staff-other';
const MY_CLASS = 'class-mine';
const THEIR_CLASS = 'class-theirs';

const session = (id: string, classId: string, teacherId: string, date = '2026-10-07') => ({
  id,
  org_id: ORG,
  class_id: classId,
  teacher_id: teacherId,
  session_date: date,
});
const change = (id: string, sessionId: string, date = '2026-10-07', org = ORG) => ({
  id,
  org_id: org,
  session_id: sessionId,
  change_type: 'cancellation',
  operation_source: 'single',
  batch_id: null,
  reason: '颱風',
  created_by_name: '管理員甲',
  created_at: `2026-10-0${id.length}T00:00:00Z`,
  sessions: { session_date: date, classes: { name: '班' } },
  staff: null,
});

function app(opts: { roles?: string[]; staff?: boolean; extra?: Record<string, unknown>[] } = {}) {
  const db = createMultiOrgDb({
    staff: opts.staff === false ? [] : [{ id: ME, user_id: 'u1', org_id: ORG }],
    schedules: [
      { class_id: MY_CLASS, teacher_id: ME, classes: { org_id: ORG } },
      { class_id: THEIR_CLASS, teacher_id: OTHER, classes: { org_id: ORG } },
    ],
    sessions: [
      session('s-mine', MY_CLASS, OTHER), // 我的班，別人代課 → 仍是我的班
      session('s-sub', THEIR_CLASS, ME), // 別人的班，我代課
      session('s-theirs', THEIR_CLASS, OTHER),
      session('s-old', MY_CLASS, ME, '2026-09-01'),
    ],
    schedule_changes: [
      change('c1', 's-mine'),
      change('c22', 's-sub'),
      change('c333', 's-theirs'),
      change('c4444', 's-old', '2026-09-01'),
      ...(opts.extra ?? []),
    ],
  });
  const hono = new Hono();
  hono.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'u1');
    set('roles', opts.roles ?? ['teacher']);
    await next();
  });
  hono.route('/', teacherChangesRoute as unknown as Hono);
  return hono;
}

const get = async (a: Hono, qs = 'from=2026-10-05&to=2026-10-11') => {
  const res = await a.request(`/?${qs}`);
  return { res, body: (await res.json()) as { data: { id: string; createdByName: unknown }[] } };
};

describe('GET /api/teacher/session-changes', () => {
  it('只回任課班與代課課堂的異動；別人的班與區間外不回', async () => {
    const { body } = await get(app());
    expect(body.data.map((r) => r.id).sort()).toEqual(['c1', 'c22']);
  });

  it('不給操作者姓名', async () => {
    const { body } = await get(app());
    expect(body.data.every((r) => r.createdByName === null)).toBe(true);
  });

  it('同時有 admin 角色也不會變全校（範圍看本人 staff.id）', async () => {
    const { body } = await get(app({ roles: ['admin', 'teacher'] }));
    expect(body.data.map((r) => r.id).sort()).toEqual(['c1', 'c22']);
  });

  it('別 org 的異動不混進來', async () => {
    const { body } = await get(app({ extra: [change('cx', 's-mine', '2026-10-07', 'org-b')] }));
    expect(body.data.map((r) => r.id)).not.toContain('cx');
  });

  it('沒有 staff 列 → 403', async () => {
    const { res } = await get(app({ staff: false }));
    expect(res.status).toBe(403);
  });

  it('區間倒置或超過 31 天 → 400', async () => {
    expect((await get(app(), 'from=2026-10-11&to=2026-10-05')).res.status).toBe(400);
    expect((await get(app(), 'from=2026-01-01&to=2026-10-05')).res.status).toBe(400);
  });
});
