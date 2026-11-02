import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import classesRoute, { mapClass } from './classes';

/**
 * #2089：班級自己的適用年級（`classes.grade_levels`，A6 班級表單的 `.grades`）。
 * 班級沒填＝沿用課程的；20260225 以前留下的中文值（「國一」）不是 key，也當沒填。
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const CLASS_A = id(101);

const row = (gradeLevels: unknown) => ({
  id: CLASS_A,
  grade_levels: gradeLevels,
  courses: { name: '國中數學', grade_levels: ['J1', 'J2'] },
});

describe('mapClass —— gradeLevels', () => {
  it('班級有填：用班級的', () => {
    expect(mapClass(row(['J3'])).gradeLevels).toEqual(['J3']);
  });

  it('班級沒填、或只有搬遷前的中文值：退回課程的', () => {
    expect(mapClass(row([])).gradeLevels).toEqual(['J1', 'J2']);
    expect(mapClass(row(null)).gradeLevels).toEqual(['J1', 'J2']);
    expect(mapClass(row(['國一'])).gradeLevels).toEqual(['J1', 'J2']);
  });

  // 表單要分辨「沿用課程」和「自己存了跟課程一樣的」—— 合併值兩者長得一樣
  it('ownGradeLevels 是班級自己存的：沿用＝空；自己存了跟課程一樣的照樣回自己那份', () => {
    expect(mapClass(row([])).ownGradeLevels).toEqual([]);
    expect(mapClass(row(['國一'])).ownGradeLevels).toEqual([]);
    expect(mapClass(row(['J1', 'J2'])).ownGradeLevels).toEqual(['J1', 'J2']);
    expect(mapClass(row(['J1', 'J2'])).gradeLevels).toEqual(['J1', 'J2']);
  });
});

function call(db: ReturnType<typeof createMultiOrgDb>, body: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG_A);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['manage_courses']);
    set('campusScope', null);
    await next();
  });
  app.route('/', classesRoute as unknown as Hono);
  return app.request(`/${CLASS_A}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/classes/:id —— gradeLevels（#2089）', () => {
  const seed = () =>
    createMultiOrgDb({
      classes: [{ id: CLASS_A, org_id: ORG_A, name: 'A 班', is_active: true, grade_levels: [] }],
    });
  const gradesOf = (db: ReturnType<typeof seed>) =>
    db.rows('classes').find((r) => r['id'] === CLASS_A)?.['grade_levels'];

  it('寫入班級的年級（重複的去掉）', async () => {
    const db = seed();
    const res = await call(db, { gradeLevels: ['J2', 'J3', 'J2'] });
    expect(res.status).toBe(200);
    expect(gradesOf(db)).toEqual(['J2', 'J3']);
  });

  it('不是年級 key 的值擋下（400），不寫入', async () => {
    const db = seed();
    const res = await call(db, { gradeLevels: ['國一'] });
    expect(res.status).toBe(400);
    expect(gradesOf(db)).toEqual([]);
  });
});
