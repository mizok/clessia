import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { getCurrentTaipeiDateString } from '../lib/taipei-date';
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

async function list(
  campusScope: string[] | null = null,
  field: 'activeClassCount' | 'endedClassCount' = 'activeClassCount',
) {
  const db = createMultiOrgDb({
    courses: [course('k1'), course('k2')],
    subjects: [{ id: 'sub-1', org_id: ORG, name: '數學', sort_order: 0 }],
    classes: [
      cls('c1', 'k1'),
      cls('c2', 'k1', { campus_id: 'campus-2' }),
      cls('c3', 'k1', { end_date: '2999-12-31' }),
      cls('c-off', 'k1', { is_active: false }),
      // 結束日＝今天：還沒結束（進 activeClassCount、不進 endedClassCount）。這條是唯一靠今天的 fixture，
      // 專門釘 `end_date < today`（不是 <=）這個邊界
      cls('c-today', 'k1', { end_date: getCurrentTaipeiDateString() }),
      cls('c-ended', 'k1', { end_date: '2000-01-01' }),
      cls('c-ended-2', 'k1', { end_date: '2000-02-01', campus_id: 'campus-2', is_active: false }),
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
  const body = (await res.json()) as {
    data: Array<{ id: string; activeClassCount: number; endedClassCount: number }>;
  };
  return Object.fromEntries(body.data.map((row) => [row.id, row[field]]));
}

describe('GET /courses —— activeClassCount（#1314 (c)）', () => {
  it('只數本 org、啟用、未結束的班；沒有班是 0', async () => {
    expect(await list()).toEqual({ k1: 4, k2: 0 });
  });

  it('受限者只數範圍內分校的班', async () => {
    expect(await list(['campus-1'])).toEqual({ k1: 3, k2: 0 });
  });
});

describe('GET /courses —— endedClassCount（課程列「另有 N 個已結束的班」）', () => {
  it('數 end_date 早於今天的班（不論啟用與否）；本 org、沒有班是 0；啟用中的與沒有結束日的不算', async () => {
    // c-ended（campus-1）＋c-ended-2（campus-2、已停用）；c3 結束日在遠未來、c-off 沒有結束日 → 都不算
    expect(await list(null, 'endedClassCount')).toEqual({ k1: 2, k2: 0 });
  });

  it('受限者只數範圍內分校的班', async () => {
    expect(await list(['campus-1'], 'endedClassCount')).toEqual({ k1: 1, k2: 0 });
  });
});
