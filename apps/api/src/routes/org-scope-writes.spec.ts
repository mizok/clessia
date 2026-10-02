import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import campusesRoute from './campuses';
import coursesRoute from './courses';
import subjectsRoute from './subjects';

/**
 * **path 帶 id 的寫入要以 `org_id` 範圍定位（c1，#966 B1）。**
 *
 * 修之前這六支只用 `.eq('id', id)`：org A 的管理員拿 org B 的 id 打 PUT / DELETE，
 * 改得動、刪得掉，而且回 200。替身真的照條件過濾（`test-utils/multi-org-db.ts`），
 * 所以斷言的是「B 的列真的沒變」，不是「查詢長得像有帶條件」。
 *
 * 每支兩條：別 org 的 id → 404 且列沒變；同 org 的 id → 200（防過度擋）。
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const CAMPUS_A = id(101);
const CAMPUS_B = id(102);
const SUBJECT_A = id(201);
const SUBJECT_B = id(202);
const COURSE_A = id(301);
const COURSE_B = id(302);

function seed() {
  return createMultiOrgDb({
    campuses: [
      { id: CAMPUS_A, org_id: ORG_A, name: 'A 校', is_active: true },
      { id: CAMPUS_B, org_id: ORG_B, name: 'B 校', is_active: true },
    ],
    subjects: [
      { id: SUBJECT_A, org_id: ORG_A, name: '數學', sort_order: 1 },
      { id: SUBJECT_B, org_id: ORG_B, name: '英文', sort_order: 1 },
    ],
    // 課程掛在另一個分校 id 上，免得擋到「刪分校」的同 org 那條
    courses: [
      {
        id: COURSE_A,
        org_id: ORG_A,
        campus_id: id(901),
        subject_id: id(902),
        name: 'A 課',
        is_active: true,
      },
      {
        id: COURSE_B,
        org_id: ORG_B,
        campus_id: id(903),
        subject_id: id(904),
        name: 'B 課',
        is_active: true,
      },
    ],
  });
}

function request(
  route: unknown,
  db: ReturnType<typeof seed>,
  method: string,
  path: string,
  body?: unknown,
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG_A);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', null);
    await next();
  });
  app.route('/', route as Hono);
  return app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

const CASES = [
  {
    name: 'PUT /api/campuses/:id',
    route: campusesRoute,
    table: 'campuses',
    method: 'PUT',
    mine: CAMPUS_A,
    theirs: CAMPUS_B,
    body: { name: '改名' },
  },
  {
    name: 'DELETE /api/campuses/:id',
    route: campusesRoute,
    table: 'campuses',
    method: 'DELETE',
    mine: CAMPUS_A,
    theirs: CAMPUS_B,
  },
  {
    name: 'PUT /api/subjects/:id',
    route: subjectsRoute,
    table: 'subjects',
    method: 'PUT',
    mine: SUBJECT_A,
    theirs: SUBJECT_B,
    body: { name: '改名' },
  },
  {
    name: 'DELETE /api/subjects/:id',
    route: subjectsRoute,
    table: 'subjects',
    method: 'DELETE',
    mine: SUBJECT_A,
    theirs: SUBJECT_B,
  },
  {
    name: 'PUT /api/courses/:id',
    route: coursesRoute,
    table: 'courses',
    method: 'PUT',
    mine: COURSE_A,
    theirs: COURSE_B,
    body: { name: '改名' },
  },
  {
    name: 'DELETE /api/courses/:id',
    route: coursesRoute,
    table: 'courses',
    method: 'DELETE',
    mine: COURSE_A,
    theirs: COURSE_B,
  },
] as const;

describe.each(CASES)('$name', ({ route, table, method, mine, theirs, ...rest }) => {
  const body = 'body' in rest ? rest.body : undefined;

  it('別 org 的 id → 404，那一列沒變', async () => {
    const db = seed();
    const before = db.rows(table).find((row) => row['id'] === theirs);

    const res = await request(route, db, method, `/${theirs}`, body);

    expect(res.status).toBe(404);
    expect(db.rows(table).find((row) => row['id'] === theirs)).toEqual(before);
  });

  it('同 org 的 id → 200，真的寫進去', async () => {
    const db = seed();

    const res = await request(route, db, method, `/${mine}`, body);

    expect(res.status).toBe(200);
    const row = db.rows(table).find((r) => r['id'] === mine);
    if (method === 'DELETE') expect(row).toBeUndefined();
    else expect(row?.['name']).toBe('改名');
  });
});
