import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createChildDb } from '../../lib/child-db';
import { createMultiOrgDb } from '../../test-utils/multi-org-db';
import trialRequestsRoute from './trial-requests';

/**
 * 家長端試聽申請（#1120）。真的 `createChildDb` 疊在照條件過濾的替身上（同 enrollment-requests）。
 * **不扣名額**（試聽算不算名額待裁）—— 額滿的班照樣收試聽申請。
 */
const ORG = 'org-1';
const MY_CHILD = '00000000-0000-4000-8000-0000000000b1';
const OTHER_CHILD = '00000000-0000-4000-8000-0000000000b2';
const MATH = '00000000-0000-4000-8000-0000000000d1';
const ENGLISH = '00000000-0000-4000-8000-0000000000d2';
const CLOSED = '00000000-0000-4000-8000-0000000000d3';
const FOREIGN = '00000000-0000-4000-8000-0000000000d9';

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return createMultiOrgDb({
    courses: [
      { id: MATH, org_id: ORG, is_active: true },
      { id: ENGLISH, org_id: ORG, is_active: true },
      { id: CLOSED, org_id: ORG, is_active: false },
      { id: FOREIGN, org_id: 'org-2', is_active: true },
    ],
    ...extra,
  });
}

function appFor(db: ReturnType<typeof createMultiOrgDb>, roles = ['parent']) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', roles);
    set('orgId', ORG);
    set('userId', 'parent-user');
    set('studentScope', [MY_CHILD]);
    set('childDb', createChildDb(db.client as never, [MY_CHILD], ORG));
    await next();
  });
  app.route('/', trialRequestsRoute as unknown as Hono);
  return app;
}

async function submit(body: Record<string, unknown>, db = seed(), roles?: string[]) {
  const res = await appFor(db, roles).request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId: MY_CHILD, ...body }),
  });
  return { status: res.status, body: (await res.json()) as any, rows: db.rows('trial_requests') };
}

describe('POST /api/me/trial-requests', () => {
  it('一次兩門課：拆成兩筆 pending，org 與送出者取 session', async () => {
    const { status, body, rows } = await submit({
      courseIds: [MATH, ENGLISH],
      preferredTimes: '週六上午',
    });

    expect(status).toBe(201);
    expect(body.data).toHaveLength(2);
    expect(rows.map((r) => [r['course_id'], r['status'], r['org_id'], r['requested_by']])).toEqual([
      [MATH, 'pending', ORG, 'parent-user'],
      [ENGLISH, 'pending', ORG, 'parent-user'],
    ]);
  });

  it('同一門課送兩次（陣列重複）只建一筆', async () => {
    const { rows } = await submit({ courseIds: [MATH, MATH] });

    expect(rows).toHaveLength(1);
  });

  it('別人的孩子：403，沒寫', async () => {
    const { status, rows } = await submit({ studentId: OTHER_CHILD, courseIds: [MATH] });

    expect(status).toBe(403);
    expect(rows).toHaveLength(0);
  });

  it('混了別 org 的課：404，整批不寫', async () => {
    const { status, rows } = await submit({ courseIds: [MATH, FOREIGN] });

    expect(status).toBe(404);
    expect(rows).toHaveLength(0);
  });

  it('停開的課：409 COURSE_NOT_OPEN', async () => {
    const { status, body } = await submit({ courseIds: [CLOSED] });

    expect(status).toBe(409);
    expect(body.code).toBe('COURSE_NOT_OPEN');
  });

  // 規格：「排除孩子已報名的課程」
  it('已經在籍的課：409 ALREADY_ENROLLED，整批不寫', async () => {
    const db = seed({
      enrollments: [
        {
          org_id: ORG,
          student_id: MY_CHILD,
          class_id: 'c1',
          status: 'active',
          classes: { course_id: MATH },
        },
      ],
    });
    const { status, body, rows } = await submit({ courseIds: [MATH, ENGLISH] }, db);

    expect(status).toBe(409);
    expect(body.code).toBe('ALREADY_ENROLLED');
    expect(rows).toHaveLength(0);
  });

  it('同門課已有進行中的試聽：409 DUPLICATE_REQUEST', async () => {
    const db = seed({
      trial_requests: [
        { id: 't1', org_id: ORG, student_id: MY_CHILD, course_id: MATH, status: 'scheduled' },
      ],
    });
    const { status, body, rows } = await submit({ courseIds: [MATH] }, db);

    expect(status).toBe(409);
    expect(body.code).toBe('DUPLICATE_REQUEST');
    expect(rows).toHaveLength(1);
  });

  it('上次試聽已完成：可以再申請', async () => {
    const db = seed({
      trial_requests: [
        { id: 't1', org_id: ORG, student_id: MY_CHILD, course_id: MATH, status: 'completed' },
      ],
    });

    expect((await submit({ courseIds: [MATH] }, db)).status).toBe(201);
  });

  it('沒選課：400', async () => {
    expect((await submit({ courseIds: [] })).status).toBe(400);
  });

  it('不是家長身分：403 NOT_PARENT', async () => {
    const { status, body } = await submit({ courseIds: [MATH] }, seed(), ['teacher']);

    expect(status).toBe(403);
    expect(body.code).toBe('NOT_PARENT');
  });
});

describe('GET /api/me/trial-requests', () => {
  it('只列自己孩子的', async () => {
    const db = seed({
      trial_requests: [
        { id: 't-mine', org_id: ORG, student_id: MY_CHILD, course_id: MATH, status: 'pending' },
        { id: 't-other', org_id: ORG, student_id: OTHER_CHILD, course_id: MATH, status: 'pending' },
      ],
    });
    const res = await appFor(db).request('/');
    const body = (await res.json()) as { data: Array<{ id: string }> };

    expect(res.status).toBe(200);
    expect(body.data.map((r) => r.id)).toEqual(['t-mine']);
  });
});
