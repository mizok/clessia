import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { notifyNewApplication } from '../../lib/notify-events';

vi.mock('../../lib/notify-events', () => ({ notifyNewApplication: vi.fn(async () => undefined) }));
import { createChildDb } from '../../lib/child-db';
import { createMultiOrgDb } from '../../test-utils/multi-org-db';
import trialRequestsRoute, { SELECT } from './trial-requests';

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

/** 讓 campuses 的查詢回錯（替身沒有錯誤注入，同 leaves.spec 的寫法） */
function failCampuses(db: ReturnType<typeof createMultiOrgDb>) {
  const client = db.client as { from: (table: string) => Record<string, unknown> };
  const realFrom = client.from.bind(client);
  const failing = {
    eq: () => failing,
    in: () => failing,
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { code: 'XX000', message: 'boom' } }),
  };
  vi.spyOn(client, 'from').mockImplementation(((table: string) => {
    const builder = realFrom(table);
    return table === 'campuses' ? { ...builder, select: () => failing } : builder;
  }) as never);
  return db;
}

const withCampus = (extra: Record<string, Array<Record<string, unknown>>> = {}) =>
  seed({
    campuses: [{ id: 'cp-main', org_id: ORG, name: '總校', phone: '02-2345-6789' }],
    ...extra,
  });

async function submit(body: Record<string, unknown>, db = seed(), roles?: string[]) {
  vi.mocked(notifyNewApplication).mockClear();
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

  // #1731（計畫席 10-19 Q7 (b)）：一次送多門課＝同一次送出，管理員只收一則
  it('一次兩門課：只通知一次，兩門課都帶、筆數 2', async () => {
    const { rows } = await submit({ courseIds: [MATH, ENGLISH] });
    expect(notifyNewApplication).toHaveBeenCalledTimes(1);
    const call = vi.mocked(notifyNewApplication).mock.calls[0]![1];
    expect(call).toMatchObject({ orgId: ORG, source: 'parent', kind: 'trial', requestCount: 2 });
    expect([...call.courseIds!].sort()).toEqual([ENGLISH, MATH].sort());
    expect(call.applicationId).toBe(rows.map((r) => r['id'] as string).sort()[0]);
  });

  it('被擋下的（停開的課、別人孩子）：不通知', async () => {
    await submit({ courseIds: [CLOSED] });
    expect(notifyNewApplication).not.toHaveBeenCalled();
    await submit({ studentId: OTHER_CHILD, courseIds: [MATH] });
    expect(notifyNewApplication).not.toHaveBeenCalled();
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

  // 審核席 T1：送出成功的回應也帶分校名稱與電話（課程沒分校 → null）
  it('送出成功：回應帶各課程分校的名稱與電話', async () => {
    const db = withCampus({
      courses: [
        { id: MATH, org_id: ORG, is_active: true, campus_id: 'cp-main' },
        { id: ENGLISH, org_id: ORG, is_active: true, campus_id: null },
      ],
    });
    const { status, body } = await submit({ courseIds: [MATH, ENGLISH] }, db);

    expect(status).toBe(201);
    const by = (id: string) => body.data.find((r: { courseId: string }) => r.courseId === id);
    expect([by(MATH).campusName, by(MATH).campusPhone]).toEqual(['總校', '02-2345-6789']);
    expect([by(ENGLISH).campusName, by(ENGLISH).campusPhone]).toEqual([null, null]);
  });

  // 已經寫進去了，讀分校失敗不該讓家長以為沒送出（列表重抓會有電話）
  it('寫入後讀分校失敗：照樣 201，分校欄位是 null', async () => {
    const db = failCampuses(
      withCampus({ courses: [{ id: MATH, org_id: ORG, is_active: true, campus_id: 'cp-main' }] }),
    );
    const { status, body, rows } = await submit({ courseIds: [MATH] }, db);

    expect(status).toBe(201);
    expect(rows).toHaveLength(1);
    expect([body.data[0].campusName, body.data[0].campusPhone]).toEqual([null, null]);
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

  // #1727 Q2 (b)：已排定的試聽帶日期與時間（時間去掉秒）；還沒排的都是 null
  it('帶排定的日期與時間', async () => {
    const db = seed({
      trial_requests: [
        {
          id: 't-done',
          org_id: ORG,
          student_id: MY_CHILD,
          course_id: MATH,
          status: 'scheduled',
          scheduled_date: '2026-10-21',
          scheduled_start_time: '18:30:00',
          scheduled_end_time: '20:00:00',
        },
        { id: 't-wait', org_id: ORG, student_id: MY_CHILD, course_id: ENGLISH, status: 'pending' },
      ],
    });
    const body = (await (await appFor(db).request('/')).json()) as {
      data: Array<Record<string, unknown>>;
    };
    const pick = (id: string) => {
      const r = body.data.find((x) => x['id'] === id)!;
      return [r['scheduledDate'], r['scheduledStartTime'], r['scheduledEndTime']];
    };
    expect(pick('t-done')).toEqual(['2026-10-21', '18:30', '20:00']);
    expect(pick('t-wait')).toEqual([null, null, null]);
  });

  // #1727 Q-b：試聽沒有取消鈕，詳情要放分校電話。課程的分校讀不到（別 org、沒這間）或沒填電話 → null
  it('帶課程所屬分校的名稱與電話；讀不到或沒電話 → null', async () => {
    const row = (id: string, campusId: string | null) => ({
      id,
      org_id: ORG,
      student_id: MY_CHILD,
      course_id: MATH,
      status: 'pending',
      courses: { name: '數學', campus_id: campusId },
    });
    const db = seed({
      campuses: [
        { id: 'cp-main', org_id: ORG, name: '總校', phone: '02-2345-6789' },
        { id: 'cp-nophone', org_id: ORG, name: '二校', phone: '  ' },
        { id: 'cp-foreign', org_id: 'org-2', name: '別家', phone: '03-000-0000' },
      ],
      trial_requests: [
        row('t-main', 'cp-main'),
        row('t-nophone', 'cp-nophone'),
        row('t-foreign', 'cp-foreign'),
        row('t-none', null),
      ],
    });
    const body = (await (await appFor(db).request('/')).json()) as {
      data: Array<Record<string, unknown>>;
    };
    const pick = (id: string) => {
      const r = body.data.find((x) => x['id'] === id)!;
      return [r['campusName'], r['campusPhone']];
    };
    expect(pick('t-main')).toEqual(['總校', '02-2345-6789']);
    expect(pick('t-nophone')).toEqual(['二校', null]);
    expect(pick('t-foreign')).toEqual([null, null]);
    expect(pick('t-none')).toEqual([null, null]);
  });

  // fail-closed：讀不到分校就回 500，不回一份「沒有電話」的列表讓家長以為補習班沒留電話
  it('讀分校失敗：500', async () => {
    const db = failCampuses(
      withCampus({
        trial_requests: [
          {
            id: 't1',
            org_id: ORG,
            student_id: MY_CHILD,
            course_id: MATH,
            status: 'pending',
            courses: { name: '數學', campus_id: 'cp-main' },
          },
        ],
      }),
    );
    const res = await appFor(db).request('/');

    expect(res.status).toBe(500);
  });
});

// 替身不看 select 欄位（一律回整列），上面的 spec 守不住「select 有沒有撈」—— 直接斷言（同 #1742 的做法）
describe('試聽申請的 select', () => {
  it('有撈 scheduled_date、scheduled_start_time、scheduled_end_time', () => {
    expect(SELECT).toContain('scheduled_date');
    expect(SELECT).toContain('scheduled_start_time');
    expect(SELECT).toContain('scheduled_end_time');
  });

  it('課程有撈 campus_id（分校電話靠它查）', () => {
    expect(SELECT).toMatch(/courses\([^)]*campus_id/);
  });
});
