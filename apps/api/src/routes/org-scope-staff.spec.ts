import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import staffRoute from './staff';

/**
 * **人員的讀寫要以 `org_id` 定位（c1，#966 B3）。**
 *
 * 根因只有一處：`getStaffById` 沒有 org 條件，而 GET／PUT／封存／停用／啟用／刪除
 * 全部經過它。修之前 org A 的管理員拿 org B 的人員 id，看得到對方的資料、
 * 改得動、封存得掉（連同移除對方的登入角色）。
 *
 * 每支兩條：別 org → 404 且 B 的資料沒變；同 org → 照常（防過度擋）。
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const REQUESTER = 'admin-a';
const STAFF_A = id(101);
const STAFF_B = id(102);
const USER_A = 'user-a';
const USER_B = 'user-b';

function seed() {
  return createMultiOrgDb({
    staff: [
      { id: STAFF_A, org_id: ORG_A, user_id: USER_A, display_name: 'A 老師', status: 'active' },
      { id: STAFF_B, org_id: ORG_B, user_id: USER_B, display_name: 'B 老師', status: 'active' },
    ],
    profiles: [
      { id: USER_A, org_id: ORG_A, display_name: 'A 老師' },
      { id: USER_B, org_id: ORG_B, display_name: 'B 老師' },
    ],
    user_roles: [
      { user_id: REQUESTER, role: 'admin', permissions: ['*'] },
      { user_id: USER_A, role: 'teacher', permissions: [] },
      { user_id: USER_B, role: 'teacher', permissions: [] },
    ],
    sessions: [],
    staff_campuses: [],
    staff_subjects: [],
    ba_user: [],
  });
}

type Db = ReturnType<typeof seed>;

function call(db: Db, method: string, path: string, body?: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG_A);
    set('userId', REQUESTER);
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', null);
    await next();
  });
  app.route('/', staffRoute as unknown as Hono);
  return app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

const orgBSnapshot = (db: Db) => ({
  staff: db.rows('staff').filter((r) => r['org_id'] === ORG_B),
  profiles: db.rows('profiles').filter((r) => r['org_id'] === ORG_B),
  roles: db.rows('user_roles').filter((r) => r['user_id'] === USER_B),
});

const staffA = (db: Db) => db.rows('staff').find((r) => r['id'] === STAFF_A);

const CASES = [
  {
    name: 'GET /api/staff/:id',
    method: 'GET',
    suffix: '',
    status: 200,
    applied: () => true,
  },
  {
    name: 'PUT /api/staff/:id',
    method: 'PUT',
    suffix: '',
    body: { displayName: '改名' },
    status: 200,
    applied: (db: Db) =>
      staffA(db)?.['display_name'] === '改名' &&
      db.rows('profiles').find((r) => r['id'] === USER_A)?.['display_name'] === '改名',
  },
  {
    name: 'PATCH /api/staff/:id/archive',
    method: 'PATCH',
    suffix: '/archive',
    status: 200,
    applied: (db: Db) =>
      staffA(db)?.['status'] === 'archived' &&
      !db.rows('user_roles').some((r) => r['user_id'] === USER_A),
  },
  {
    name: 'PATCH /api/staff/:id/deactivate',
    method: 'PATCH',
    suffix: '/deactivate',
    status: 200,
    applied: (db: Db) => staffA(db)?.['status'] === 'inactive',
  },
  {
    name: 'PATCH /api/staff/:id/activate',
    method: 'PATCH',
    suffix: '/activate',
    status: 200,
    applied: (db: Db) => staffA(db)?.['status'] === 'active',
  },
  // 刪除一律 409（#833 只能封存）—— 但別 org 的 id 要先拿到 404，不是 409
  {
    name: 'DELETE /api/staff/:id',
    method: 'DELETE',
    suffix: '',
    status: 409,
    applied: (db: Db) => staffA(db) !== undefined,
  },
] as const;

describe.each(CASES)('$name', ({ method, suffix, status, applied, ...rest }) => {
  const body = 'body' in rest ? rest.body : undefined;

  it('別 org → 404，B 那一側什麼都沒變（也不回對方的資料）', async () => {
    const db = seed();
    const before = orgBSnapshot(db);

    const res = await call(db, method, `/${STAFF_B}${suffix}`, body);

    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('B 老師');
    expect(orgBSnapshot(db)).toEqual(before);
  });

  it('同 org → 照常', async () => {
    const db = seed();

    const res = await call(db, method, `/${STAFF_A}${suffix}`, body);

    expect(res.status).toBe(status);
    expect(applied(db)).toBe(true);
  });
});
