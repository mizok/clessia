import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import classesRoute from './classes';

/**
 * A6「17／24 人」：班級列表每列帶 `enrolledCount`＝**今天**在籍的人數。
 * 判準是 `lib/session-roster.ts` 的 `countEnrolledOn`（課堂名單、點名同一份）：
 * status=active、`effective_from` ≤ 今天、`effective_to` 空或 ≥ 今天。日期一律用遠古／遠未來，不靠今天。
 */

const ORG = 'org-a';
const klass = (id: string) => ({
  id,
  org_id: ORG,
  course_id: 'k1',
  campus_id: 'campus-1',
  name: id,
  is_active: true,
  max_students: 24,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});
const enr = (classId: string, extra: Record<string, unknown> = {}) => ({
  id: `e-${Math.random()}`,
  org_id: ORG,
  class_id: classId,
  status: 'active',
  effective_from: '2000-01-01',
  effective_to: null,
  ...extra,
});

async function list(enrollments: Array<Record<string, unknown>>) {
  const db = createMultiOrgDb({
    classes: [klass('c1'), klass('c2')],
    enrollments,
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'u1');
    set('roles', ['admin']);
    set('campusScope', null);
    await next();
  });
  app.route('/', classesRoute as unknown as Hono);
  const res = await app.request('/');
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: Array<{ id: string; enrolledCount?: number }> };
  return Object.fromEntries(body.data.map((row) => [row.id, row.enrolledCount]));
}

describe('GET /classes —— enrolledCount（A6「17／24 人」）', () => {
  it('只數今天在籍的 active 報名；沒有人是 0（不是 undefined）', async () => {
    expect(
      await list([
        enr('c1'),
        enr('c1'),
        enr('c1', { effective_to: '2999-12-31' }), // 還沒結束 → 算
        enr('c1', { effective_to: '2000-06-01' }), // 已結束 → 不算
        enr('c1', { effective_from: '2999-01-01' }), // 還沒開始 → 不算
        enr('c1', { status: 'inactive' }), // 不是 active → 不算
        enr('c1', { org_id: 'org-b' }), // 別的 org → 不算
        enr('c2'),
      ]),
    ).toEqual({ c1: 3, c2: 1 });
    expect(await list([])).toEqual({ c1: 0, c2: 0 });
  });
});
