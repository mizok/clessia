import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import coursesRoute from './courses';

/**
 * #1314 (c)：課程列表每列帶 `activeClassCount`。
 * 「進行中」＝ is_active 且 end_date 空或 ≥ 今天；受限者只數範圍內的班。結束日用遠古／遠未來，不靠今天。
 */

const ORG = 'org-a';
const course = (id: string) => ({
  id,
  org_id: ORG,
  campus_id: 'campus-1',
  subject_id: 'sub-1',
  name: id,
  is_active: true,
  campuses: { name: '本校' },
  subjects: { name: '數學', sort_order: 0 },
});
const cls = (id: string, courseId: string, extra: Record<string, unknown> = {}) => ({
  id,
  org_id: ORG,
  course_id: courseId,
  campus_id: 'campus-1',
  is_active: true,
  end_date: null,
  ...extra,
});

async function list(campusScope: string[] | null = null) {
  const db = createMultiOrgDb({
    courses: [course('k1'), course('k2')],
    subjects: [{ id: 'sub-1', org_id: ORG, name: '數學', sort_order: 0 }],
    classes: [
      cls('c1', 'k1'),
      cls('c2', 'k1', { campus_id: 'campus-2' }),
      cls('c3', 'k1', { end_date: '2999-12-31' }),
      cls('c-off', 'k1', { is_active: false }),
      cls('c-ended', 'k1', { end_date: '2000-01-01' }),
      cls('c-other', 'k1', { org_id: 'org-b' }),
    ],
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'u1');
    set('roles', ['admin']);
    set('campusScope', campusScope);
    await next();
  });
  app.route('/', coursesRoute as unknown as Hono);
  const res = await app.request('/');
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: Array<{ id: string; activeClassCount: number }> };
  return Object.fromEntries(body.data.map((row) => [row.id, row.activeClassCount]));
}

describe('GET /courses —— activeClassCount（#1314 (c)）', () => {
  it('只數本 org、啟用、未結束的班；沒有班是 0', async () => {
    expect(await list()).toEqual({ k1: 3, k2: 0 });
  });

  it('受限者只數範圍內分校的班', async () => {
    expect(await list(['campus-1'])).toEqual({ k1: 2, k2: 0 });
  });
});
