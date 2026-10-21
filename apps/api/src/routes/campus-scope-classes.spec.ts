import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import classesRoute from './classes';

/**
 * **班級寫入的分校範圍（#1797）**：只管分校 1 的管理員，改不到分校 2 的班 ——
 * 改班、停用、刪除、時段 CRUD、產生／批次改課堂、停未來課堂、批次停用、在別校的課程底下開班。
 * 範圍外 → 403、資料沒動（同 #1783 `campusForClassrooms`）；範圍內照常；不受限的管理員照常。
 * 讀取面早就套了 `applyCampusFilter`，寫入面原本只驗 org（`org-scope-classes.spec` 守的是那一層）。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const CAMPUS_1 = id(11);
const CAMPUS_2 = id(12);
const COURSE_1 = id(21);
const COURSE_2 = id(22);
const MINE = id(101);
const THEIRS = id(102);
const SCHEDULE_MINE = id(201);
const SCHEDULE_THEIRS = id(202);
const SLOT = { weekday: 2, startTime: '14:00', endTime: '15:00' };
const RANGE = { from: '2099-01-01', to: '2099-01-31' };

function seed() {
  return createMultiOrgDb({
    courses: [
      { id: COURSE_1, org_id: ORG, campus_id: CAMPUS_1, name: '一校課', is_active: true },
      { id: COURSE_2, org_id: ORG, campus_id: CAMPUS_2, name: '二校課', is_active: true },
    ],
    classes: [
      {
        id: MINE,
        org_id: ORG,
        campus_id: CAMPUS_1,
        course_id: COURSE_1,
        name: '一校班',
        is_active: true,
      },
      {
        id: THEIRS,
        org_id: ORG,
        campus_id: CAMPUS_2,
        course_id: COURSE_2,
        name: '二校班',
        is_active: true,
      },
    ],
    schedules: [
      { id: SCHEDULE_MINE, class_id: MINE, weekday: 1, start_time: '10:00', end_time: '11:00' },
      { id: SCHEDULE_THEIRS, class_id: THEIRS, weekday: 1, start_time: '10:00', end_time: '11:00' },
    ],
    sessions: [
      {
        id: id(301),
        org_id: ORG,
        class_id: THEIRS,
        session_date: '2099-01-05',
        status: 'scheduled',
      },
    ],
    enrollments: [],
    session_packs: [],
    audit_logs: [],
    profiles: [],
  });
}

type Db = ReturnType<typeof seed>;

async function call(
  db: Db,
  method: string,
  path: string,
  body?: unknown,
  scope: readonly string[] | null = [CAMPUS_1],
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'admin-1');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', scope);
    await next();
  });
  app.route('/', classesRoute as unknown as Hono);
  const res = await app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return res.status;
}

/** 分校 2 那一側的全部資料 —— 斷言「範圍外的請求沒有碰到任何東西」 */
const theirSide = (db: Db) =>
  JSON.stringify({
    classes: db.rows('classes').filter((r) => r['id'] === THEIRS),
    schedules: db.rows('schedules').filter((r) => r['class_id'] === THEIRS),
    sessions: db.rows('sessions'),
  });

/** 路徑帶班級 id 的每一支寫入：[名稱, method, path(班級 id), body] */
const PATH_WRITES = [
  ['PUT /:id', 'PUT', (c: string) => `/${c}`, { name: '改名' }],
  ['PATCH /:id/toggle-active', 'PATCH', (c: string) => `/${c}/toggle-active`, undefined],
  ['DELETE /:id', 'DELETE', (c: string) => `/${c}`, undefined],
  ['POST /:id/schedules', 'POST', (c: string) => `/${c}/schedules`, SLOT],
  [
    'PUT /:id/schedules/:sid',
    'PUT',
    (c: string) => `/${c}/schedules/${c === MINE ? SCHEDULE_MINE : SCHEDULE_THEIRS}`,
    { weekday: 3 },
  ],
  [
    'DELETE /:id/schedules/:sid',
    'DELETE',
    (c: string) => `/${c}/schedules/${c === MINE ? SCHEDULE_MINE : SCHEDULE_THEIRS}`,
    undefined,
  ],
  ['POST /:id/sessions/generate', 'POST', (c: string) => `/${c}/sessions/generate`, RANGE],
  [
    'PATCH /:id/sessions/batch-assign-teacher',
    'PATCH',
    (c: string) => `/${c}/sessions/batch-assign-teacher`,
    { ...RANGE, toTeacherId: id(901) },
  ],
  [
    'PATCH /:id/sessions/batch-update-time',
    'PATCH',
    (c: string) => `/${c}/sessions/batch-update-time`,
    { ...RANGE, newStartTime: '09:00', newEndTime: '10:00' },
  ],
  [
    'PATCH /:id/sessions/batch-cancel',
    'PATCH',
    (c: string) => `/${c}/sessions/batch-cancel`,
    RANGE,
  ],
  [
    'PATCH /:id/sessions/batch-uncancel',
    'PATCH',
    (c: string) => `/${c}/sessions/batch-uncancel`,
    RANGE,
  ],
  [
    'POST /:id/cancel-future-sessions',
    'POST',
    (c: string) => `/${c}/cancel-future-sessions`,
    undefined,
  ],
] as const;

describe.each(PATH_WRITES)('%s', (_name, method, path, body) => {
  it('只管分校 1 的管理員改分校 2 的班 → 403，分校 2 什麼都沒變', async () => {
    const db = seed();
    const before = theirSide(db);
    expect(await call(db, method, path(THEIRS), body)).toBe(403);
    expect(theirSide(db)).toBe(before);
  });

  it('自己分校的班：不是 403（防過度擋）', async () => {
    expect(await call(seed(), method, path(MINE), body)).not.toBe(403);
  });

  it('不受限的管理員改分校 2 的班：不是 403', async () => {
    expect(await call(seed(), method, path(THEIRS), body, null)).not.toBe(403);
  });
});

describe('id 在 body 裡的寫入', () => {
  it('PATCH /batch-set-active：混了一個分校 2 的班 → 整批 403，兩個都沒停；只有自己的 → 200', async () => {
    const db = seed();
    expect(
      await call(db, 'PATCH', '/batch-set-active', { ids: [MINE, THEIRS], isActive: false }),
    ).toBe(403);
    expect(db.rows('classes').every((r) => r['is_active'] === true)).toBe(true);

    expect(await call(db, 'PATCH', '/batch-set-active', { ids: [MINE], isActive: false })).toBe(
      200,
    );
    expect(db.rows('classes').find((r) => r['id'] === MINE)?.['is_active']).toBe(false);
  });

  it('POST /：在分校 2 的課程底下開班 → 403，沒開出來；自己分校的課程 → 201', async () => {
    const db = seed();
    expect(await call(db, 'POST', '/', { courseId: COURSE_2, name: '新班', maxStudents: 20 })).toBe(
      403,
    );
    expect(db.rows('classes')).toHaveLength(2);

    expect(await call(db, 'POST', '/', { courseId: COURSE_1, name: '新班', maxStudents: 20 })).toBe(
      201,
    );
  });
});
