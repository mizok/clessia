import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import classesRoute from './classes';

/**
 * **班級與排課的寫入要以 `org_id` 定位（c1，#966 B2）。**
 *
 * 修之前這幾支只用 `.eq('id')` / `.in('id')`：org A 拿 org B 的班級 id，改得動、停得掉、
 * 刪得掉（連同底下的課堂與報名一起連坐）。`schedules` 沒有 `org_id` 欄位，
 * 所以它要驗的是**父班級**屬於本 org。
 *
 * 每支兩條：別 org → 404 且 B 的資料沒變；同 org → 成功（防過度擋）。
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const CLASS_A = id(101);
const CLASS_B = id(102);
const SCHEDULE_A = id(201);
const SCHEDULE_B = id(202);
const FUTURE = '2099-01-01';

function seed() {
  return createMultiOrgDb({
    classes: [
      { id: CLASS_A, org_id: ORG_A, name: 'A 班', is_active: true },
      { id: CLASS_B, org_id: ORG_B, name: 'B 班', is_active: true },
    ],
    schedules: [
      { id: SCHEDULE_A, class_id: CLASS_A, weekday: 1, start_time: '10:00', end_time: '11:00' },
      { id: SCHEDULE_B, class_id: CLASS_B, weekday: 1, start_time: '10:00', end_time: '11:00' },
    ],
    // 未來的課堂不擋刪除，但刪班會連坐刪掉 —— 別 org 的不能被連坐
    sessions: [
      { id: id(301), org_id: ORG_A, class_id: CLASS_A, session_date: FUTURE, status: 'scheduled' },
      { id: id(302), org_id: ORG_B, class_id: CLASS_B, session_date: FUTURE, status: 'scheduled' },
    ],
    enrollments: [],
    session_packs: [],
  });
}

type Db = ReturnType<typeof seed>;

function call(db: Db, method: string, path: string, body?: unknown) {
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
  app.route('/', classesRoute as unknown as Hono);
  return app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

/** B 那一側的全部資料 —— 斷言「別 org 的請求沒有碰到任何東西」 */
const orgBSnapshot = (db: Db) => ({
  classes: db.rows('classes').filter((r) => r['org_id'] === ORG_B),
  schedules: db.rows('schedules').filter((r) => r['class_id'] === CLASS_B),
  sessions: db.rows('sessions').filter((r) => r['org_id'] === ORG_B),
});

const SLOT = { weekday: 2, startTime: '14:00', endTime: '15:00' };

const CASES = [
  {
    name: 'PUT /api/classes/:id',
    theirs: ['PUT', `/${CLASS_B}`, { name: '改名' }],
    mine: ['PUT', `/${CLASS_A}`, { name: '改名' }, 200],
    applied: (db: Db) => db.rows('classes').find((r) => r['id'] === CLASS_A)?.['name'] === '改名',
  },
  {
    name: 'PUT /api/classes/:id —— nextClassId 指名別 org 的班',
    theirs: ['PUT', `/${CLASS_A}`, { nextClassId: CLASS_B }],
    mine: ['PUT', `/${CLASS_A}`, { nextClassId: CLASS_A }, 200],
    applied: (db: Db) =>
      db.rows('classes').find((r) => r['id'] === CLASS_A)?.['next_class_id'] === CLASS_A,
  },
  {
    name: 'PATCH /api/classes/:id/toggle-active',
    theirs: ['PATCH', `/${CLASS_B}/toggle-active`],
    mine: ['PATCH', `/${CLASS_A}/toggle-active`, undefined, 200],
    applied: (db: Db) =>
      db.rows('classes').find((r) => r['id'] === CLASS_A)?.['is_active'] === false,
  },
  {
    name: 'PATCH /api/classes/batch-set-active',
    theirs: ['PATCH', '/batch-set-active', { ids: [CLASS_A, CLASS_B], isActive: false }],
    mine: ['PATCH', '/batch-set-active', { ids: [CLASS_A], isActive: false }, 200],
    applied: (db: Db) =>
      db.rows('classes').find((r) => r['id'] === CLASS_A)?.['is_active'] === false,
  },
  {
    name: 'DELETE /api/classes/batch',
    theirs: ['DELETE', '/batch', { ids: [CLASS_A, CLASS_B] }],
    mine: ['DELETE', '/batch', { ids: [CLASS_A] }, 200],
    applied: (db: Db) => !db.rows('classes').some((r) => r['id'] === CLASS_A),
  },
  {
    name: 'DELETE /api/classes/:id',
    theirs: ['DELETE', `/${CLASS_B}`],
    mine: ['DELETE', `/${CLASS_A}`, undefined, 200],
    applied: (db: Db) =>
      !db.rows('classes').some((r) => r['id'] === CLASS_A) &&
      !db.rows('sessions').some((r) => r['class_id'] === CLASS_A),
  },
  {
    name: 'POST /api/classes/:id/schedules',
    theirs: ['POST', `/${CLASS_B}/schedules`, SLOT],
    mine: ['POST', `/${CLASS_A}/schedules`, SLOT, 201],
    applied: (db: Db) =>
      db.rows('schedules').some((r) => r['class_id'] === CLASS_A && r['weekday'] === 2),
  },
  {
    name: 'PUT /api/classes/:id/schedules/:sid',
    theirs: ['PUT', `/${CLASS_B}/schedules/${SCHEDULE_B}`, { weekday: 3 }],
    mine: ['PUT', `/${CLASS_A}/schedules/${SCHEDULE_A}`, { weekday: 3 }, 200],
    applied: (db: Db) =>
      db.rows('schedules').find((r) => r['id'] === SCHEDULE_A)?.['weekday'] === 3,
  },
  {
    name: 'DELETE /api/classes/:id/schedules/:sid',
    theirs: ['DELETE', `/${CLASS_B}/schedules/${SCHEDULE_B}`],
    mine: ['DELETE', `/${CLASS_A}/schedules/${SCHEDULE_A}`, undefined, 200],
    applied: (db: Db) => !db.rows('schedules').some((r) => r['id'] === SCHEDULE_A),
  },
] as const;

describe.each(CASES)('$name', ({ theirs, mine, applied }) => {
  it('別 org → 404，B 那一側什麼都沒變', async () => {
    const db = seed();
    const before = orgBSnapshot(db);

    const [method, path, body] = theirs;
    const res = await call(db, method, path, body);

    expect(res.status).toBe(404);
    expect(orgBSnapshot(db)).toEqual(before);
  });

  it('同 org → 成功，真的寫進去', async () => {
    const db = seed();

    const [method, path, body, status] = mine;
    const res = await call(db, method, path, body);

    expect(res.status).toBe(status);
    expect(applied(db)).toBe(true);
  });
});
