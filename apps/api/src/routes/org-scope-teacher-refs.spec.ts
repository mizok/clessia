import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import classesRoute from './classes';

/**
 * **body 指名的老師要屬於本 org（c1，#966 B5a）。**
 *
 * #854 修的是任課資格（分校／科目），而 `POST /{id}/schedules` 與
 * `PATCH /{id}/sessions/batch-assign-teacher` 兩支連「這個人是不是本 org 的」都沒問 ——
 * 別 org 的人員 id 會被寫進本 org 的排課與課堂。
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const CLASS_A = id(101);
const TEACHER_A = id(201);
const TEACHER_B = id(202);

function seed() {
  return createMultiOrgDb({
    classes: [{ id: CLASS_A, org_id: ORG_A, name: 'A 班', is_active: true }],
    staff: [
      { id: TEACHER_A, org_id: ORG_A, user_id: 'user-a', status: 'active' },
      { id: TEACHER_B, org_id: ORG_B, user_id: 'user-b', status: 'active' },
    ],
    schedules: [],
    sessions: [],
  });
}

type Db = ReturnType<typeof seed>;

function call(db: Db, method: string, path: string, body: unknown) {
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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const slot = (teacherId: string) => ({
  weekday: 2,
  startTime: '14:00',
  endTime: '15:00',
  teacherId,
});

describe('POST /api/classes/:id/schedules —— teacherId 要屬於本 org', () => {
  it('別 org 的老師 → 404，沒有新增排課', async () => {
    const db = seed();

    const res = await call(db, 'POST', `/${CLASS_A}/schedules`, slot(TEACHER_B));

    expect(res.status).toBe(404);
    expect(db.rows('schedules')).toEqual([]);
  });

  it('同 org 的老師 → 201，真的排進去', async () => {
    const db = seed();

    const res = await call(db, 'POST', `/${CLASS_A}/schedules`, slot(TEACHER_A));

    expect(res.status).toBe(201);
    expect(db.rows('schedules')).toEqual([
      expect.objectContaining({ class_id: CLASS_A, teacher_id: TEACHER_A }),
    ]);
  });
});

describe('PATCH /api/classes/:id/sessions/batch-assign-teacher —— toTeacherId 要屬於本 org', () => {
  const body = (toTeacherId: string) => ({ from: '2099-01-01', to: '2099-01-31', toTeacherId });

  it('別 org 的老師 → 404', async () => {
    const res = await call(
      seed(),
      'PATCH',
      `/${CLASS_A}/sessions/batch-assign-teacher`,
      body(TEACHER_B),
    );

    expect(res.status).toBe(404);
  });

  it('同 org 的老師 → 200', async () => {
    const res = await call(
      seed(),
      'PATCH',
      `/${CLASS_A}/sessions/batch-assign-teacher`,
      body(TEACHER_A),
    );

    expect(res.status).toBe(200);
  });
});
