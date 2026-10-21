import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { notifyNewApplication } from '../../lib/notify-events';

vi.mock('../../lib/notify-events', () => ({ notifyNewApplication: vi.fn(async () => undefined) }));
import { createChildDb } from '../../lib/child-db';
import { createMultiOrgDb } from '../../test-utils/multi-org-db';
import enrollmentRequestsRoute, { SELECT } from './enrollment-requests';

/**
 * 家長端報名申請（#1119）。用**真的** `createChildDb` 疊在照條件過濾的替身上 ——
 * 範圍檢查是這支的重點，替身回固定資料的話條件下對下錯看起來一樣。
 */
const ORG = 'org-1';
const MY_CHILD = '00000000-0000-4000-8000-0000000000b1';
const OTHER_CHILD = '00000000-0000-4000-8000-0000000000b2';
const CLASS_OPEN = '00000000-0000-4000-8000-0000000000c1';
const CLASS_FULL = '00000000-0000-4000-8000-0000000000c2';
const CLASS_FOREIGN = '00000000-0000-4000-8000-0000000000c9';
const CLASS_CLOSED = '00000000-0000-4000-8000-0000000000c3';

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return createMultiOrgDb({
    classes: [
      { id: CLASS_OPEN, org_id: ORG, max_students: 2, is_active: true, end_date: null },
      { id: CLASS_FULL, org_id: ORG, max_students: 1, is_active: true, end_date: null },
      { id: CLASS_CLOSED, org_id: ORG, max_students: 9, is_active: false, end_date: null },
      { id: CLASS_FOREIGN, org_id: 'org-2', max_students: 9, is_active: true, end_date: null },
    ],
    enrollments: [
      { org_id: ORG, class_id: CLASS_FULL, student_id: 'someone', status: 'active' },
      { org_id: ORG, class_id: CLASS_OPEN, student_id: 'someone', status: 'withdrawn' },
    ],
    ...extra,
  });
}

function appFor(db: ReturnType<typeof createMultiOrgDb>, roles = ['parent'], scope = [MY_CHILD]) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', roles);
    set('orgId', ORG);
    set('userId', 'parent-user');
    set('studentScope', scope);
    set('childDb', createChildDb(db.client as never, scope, ORG));
    await next();
  });
  app.route('/', enrollmentRequestsRoute as unknown as Hono);
  return app;
}

async function submit(body: Record<string, unknown>, db = seed(), roles?: string[]) {
  vi.mocked(notifyNewApplication).mockClear();
  const res = await appFor(db, roles).request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId: MY_CHILD, ...body }),
  });
  return {
    status: res.status,
    body: (await res.json()) as any,
    rows: db.rows('enrollment_requests'),
  };
}

describe('POST /api/me/enrollment-requests', () => {
  it('有位子：建一筆 pending，org 與送出者取 session', async () => {
    const { status, body, rows } = await submit({ classId: CLASS_OPEN, note: '想上週六' });

    expect(status).toBe(201);
    expect(body.status).toBe('pending');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      org_id: ORG,
      student_id: MY_CHILD,
      class_id: CLASS_OPEN,
      requested_by: 'parent-user',
      status: 'pending',
    });
  });

  // #1727 Q1 (b)：家長選的繳費週期；堂數制行政議定、家長不能選（計畫席 10-19 B (b)）
  it('繳費週期：月繳／期繳照存、回應帶回；沒選是 null', async () => {
    const monthly = await submit({ classId: CLASS_OPEN, billingMode: 'monthly' });
    expect(monthly.status).toBe(201);
    expect(monthly.body.billingMode).toBe('monthly');
    expect(monthly.rows[0]!['billing_mode']).toBe('monthly');

    const none = await submit({ classId: CLASS_OPEN });
    expect(none.body.billingMode).toBeNull();
    expect(none.rows[0]!['billing_mode']).toBeNull();
  });

  it('繳費週期選堂數制：400，沒寫', async () => {
    const { status, rows } = await submit({ classId: CLASS_OPEN, billingMode: 'session_pack' });
    expect(status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  // #1731：送出成功才通知分校管理員（去重鍵跟公開表單分開），走 childDb 的窄能力
  it('送出成功：通知一次，帶這筆申請與它的班', async () => {
    const { rows } = await submit({ classId: CLASS_OPEN });
    expect(notifyNewApplication).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyNewApplication).mock.calls[0]![1]).toMatchObject({
      orgId: ORG,
      applicationId: rows[0]!['id'],
      source: 'parent',
      kind: 'enrollment',
      classIds: [CLASS_OPEN],
      requestCount: 1,
    });
  });

  it('登記候補也通知（行政要知道有人在排）', async () => {
    await submit({ classId: CLASS_FULL, waitlist: true });
    expect(notifyNewApplication).toHaveBeenCalledTimes(1);
  });

  it('被擋下的（額滿沒說候補、別人孩子）：不通知', async () => {
    await submit({ classId: CLASS_FULL });
    expect(notifyNewApplication).not.toHaveBeenCalled();
    await submit({ classId: CLASS_OPEN, studentId: OTHER_CHILD });
    expect(notifyNewApplication).not.toHaveBeenCalled();
  });

  it('額滿、沒說要候補：409 CLASS_FULL，沒寫', async () => {
    const { status, body, rows } = await submit({ classId: CLASS_FULL });

    expect(status).toBe(409);
    expect(body.code).toBe('CLASS_FULL');
    expect(rows).toHaveLength(0);
  });

  it('額滿、選擇登記候補：建一筆 waitlist', async () => {
    const { status, body } = await submit({ classId: CLASS_FULL, waitlist: true });

    expect(status).toBe(201);
    expect(body.status).toBe('waitlist');
  });

  // 約束 (3)：額滿判斷在 server，body 說要候補也不能把有位子的班變成候補
  it('有位子卻送 waitlist: true：照樣是 pending', async () => {
    const { body } = await submit({ classId: CLASS_OPEN, waitlist: true });

    expect(body.status).toBe('pending');
  });

  it('別人的孩子：403，沒寫', async () => {
    const { status, rows } = await submit({ studentId: OTHER_CHILD, classId: CLASS_OPEN });

    expect(status).toBe(403);
    expect(rows).toHaveLength(0);
  });

  it('別 org 的班：404', async () => {
    expect((await submit({ classId: CLASS_FOREIGN })).status).toBe(404);
  });

  it('停用的班：409 CLASS_NOT_OPEN', async () => {
    const { status, body } = await submit({ classId: CLASS_CLOSED });

    expect(status).toBe(409);
    expect(body.code).toBe('CLASS_NOT_OPEN');
  });

  it('已經在籍：409 ALREADY_ENROLLED', async () => {
    const db = seed({
      enrollments: [{ org_id: ORG, class_id: CLASS_OPEN, student_id: MY_CHILD, status: 'active' }],
    });
    const { status, body } = await submit({ classId: CLASS_OPEN }, db);

    expect(status).toBe(409);
    expect(body.code).toBe('ALREADY_ENROLLED');
  });

  it('同班已有進行中的申請：409 DUPLICATE_REQUEST，不會變兩筆', async () => {
    const db = seed({
      enrollment_requests: [
        { id: 'r1', org_id: ORG, student_id: MY_CHILD, class_id: CLASS_OPEN, status: 'pending' },
      ],
    });
    const { status, body, rows } = await submit({ classId: CLASS_OPEN }, db);

    expect(status).toBe(409);
    expect(body.code).toBe('DUPLICATE_REQUEST');
    expect(rows).toHaveLength(1);
  });

  it('不是家長身分：403 NOT_PARENT', async () => {
    const { status, body } = await submit({ classId: CLASS_OPEN }, seed(), ['teacher']);

    expect(status).toBe(403);
    expect(body.code).toBe('NOT_PARENT');
  });
});

describe('GET /api/me/enrollment-requests', () => {
  it('只列自己孩子的', async () => {
    const db = seed({
      enrollment_requests: [
        {
          id: 'r-mine',
          org_id: ORG,
          student_id: MY_CHILD,
          class_id: CLASS_OPEN,
          status: 'pending',
        },
        {
          id: 'r-other',
          org_id: ORG,
          student_id: OTHER_CHILD,
          class_id: CLASS_OPEN,
          status: 'pending',
        },
      ],
    });
    const res = await appFor(db).request('/');
    const body = (await res.json()) as { data: Array<{ id: string }> };

    expect(res.status).toBe(200);
    expect(body.data.map((r) => r.id)).toEqual(['r-mine']);
  });
});

describe('POST /api/me/enrollment-requests/:id/cancel', () => {
  const R = '00000000-0000-4000-8000-0000000000e1';
  const cancel = async (status: string, studentId = MY_CHILD) => {
    const db = seed({
      enrollment_requests: [
        { id: R, org_id: ORG, student_id: studentId, class_id: CLASS_OPEN, status },
      ],
    });
    const res = await appFor(db).request(`/${R}/cancel`, { method: 'POST' });
    return { status: res.status, stored: db.rows('enrollment_requests')[0]?.['status'] };
  };

  it('待審核可以取消', async () => {
    expect(await cancel('pending')).toEqual({ status: 200, stored: 'cancelled' });
  });

  it('候補也可以取消', async () => {
    expect(await cancel('waitlist')).toEqual({ status: 200, stored: 'cancelled' });
  });

  it('已核准待繳費：409，不動', async () => {
    expect(await cancel('awaiting_payment')).toEqual({ status: 409, stored: 'awaiting_payment' });
  });

  it('別人孩子的申請：404（跟不存在一樣），不動', async () => {
    expect(await cancel('pending', OTHER_CHILD)).toEqual({ status: 404, stored: 'pending' });
  });
});

// 替身不看 select 欄位（一律回整列），上面的 spec 守不住「select 有沒有撈」—— 直接斷言（同 #1742 的做法）
describe('報名申請的 select', () => {
  it('有撈 billing_mode', () => {
    expect(SELECT).toContain('billing_mode');
  });
});
