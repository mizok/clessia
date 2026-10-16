import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import parentRequestsRoute from './parent-requests';

/**
 * #1707：管理端處理家長登入後送的報名（enrollment_requests）／試聽（trial_requests）申請。
 * 跟 /api/public-applications 同一套授權：manage_students（掛載層）＋分校範圍（c1）。
 * 兩張表都沒有分校欄 —— 報名看班的分校、試聽看課程的分校（學生還沒報名，沒有 enrollment 可以推）。
 * 替身不做 embed，所以學生、班／課程直接放在申請列上（同正式回傳的形狀）。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const CAMPUS_A = 'campus-a';
const CAMPUS_B = 'campus-b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const enrollment = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  org_id: ORG,
  student_id: 'stu-1',
  class_id: 'cls-1',
  status: 'pending',
  preferred_start_date: '2026-11-01',
  note: '想上週六班',
  reject_reason: null,
  requested_by: 'user-parent-1',
  created_at: `2026-10-0${n % 9}T00:00:00Z`,
  students: { name: '林小華' },
  classes: { name: '國二數學 A', campus_id: CAMPUS_A, campuses: { name: '信義分校' } },
  ...extra,
});

const trial = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  org_id: ORG,
  student_id: 'stu-1',
  course_id: 'crs-1',
  status: 'pending',
  preferred_times: '平日晚上',
  note: null,
  requested_by: 'user-parent-1',
  created_at: `2026-10-0${n % 9}T00:00:00Z`,
  students: { name: '林小華' },
  courses: { name: '國小英文', campus_id: CAMPUS_B, campuses: { name: '大安分校' } },
  ...extra,
});

function seed(extraEnrollments: Record<string, unknown>[] = []) {
  return createMultiOrgDb({
    enrollment_requests: [
      enrollment(1),
      enrollment(2, { status: 'waitlist' }),
      enrollment(3, { status: 'awaiting_payment' }),
      enrollment(4, { status: 'cancelled' }),
      enrollment(5, { org_id: ORG_B }),
      ...extraEnrollments,
    ],
    trial_requests: [trial(6), trial(7, { status: 'scheduled' })],
    parents: [
      { id: 'p1', org_id: ORG, user_id: 'user-parent-1', name: '林媽媽' },
      // 同一個帳號在別的 org 也是家長 —— 名字要拿本 org 的
      { id: 'p2', org_id: ORG_B, user_id: 'user-parent-1', name: '別家的名字' },
    ],
    ba_user: [{ id: 'user-parent-1', phone: '0912000111' }],
    audit_logs: [],
    profiles: [],
  });
}

function call(
  db: ReturnType<typeof seed>,
  path: string,
  init: RequestInit = {},
  scope: readonly string[] | null = null,
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'admin-1');
    set('roles', ['admin']);
    set('permissions', ['manage_students']);
    set('campusScope', scope);
    await next();
  });
  app.route('/', parentRequestsRoute as unknown as Hono);
  return app.request(path, init, {}, {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  } as never);
}

const ids = async (res: Response) =>
  ((await res.json()) as any).data.map((a: { id: string }) => a.id);

describe('GET /api/parent-requests', () => {
  it('預設「待處理」：報名的 pending＋waitlist、試聽的 pending；本 org、新的在前；兩種合在一份', async () => {
    const res = await call(seed(), '/');
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.map((a: { id: string }) => a.id)).toEqual([id(6), id(2), id(1)]);
    expect(body.data.find((a: { id: string }) => a.id === id(1))).toEqual({
      id: id(1),
      kind: 'enrollment',
      status: 'pending',
      createdAt: '2026-10-01T00:00:00Z',
      student: { id: 'stu-1', name: '林小華' },
      parent: { name: '林媽媽', phone: '0912000111' },
      target: { name: '國二數學 A', campusName: '信義分校' },
      preferredStartDate: '2026-11-01',
      preferredTimes: null,
      note: '想上週六班',
      rejectReason: null,
    });
    expect(body.data.find((a: { id: string }) => a.id === id(6))).toMatchObject({
      kind: 'trial',
      target: { name: '國小英文', campusName: '大安分校' },
      preferredTimes: '平日晚上',
      preferredStartDate: null,
    });
  });

  it.each([
    ['active', [id(7), id(3)]],
    ['cancelled', [id(4)]],
    ['done', []],
  ])('?group=%s', async (group, expected) => {
    expect(await ids(await call(seed(), `/?group=${group}`))).toEqual(expected);
  });

  it('?kind=trial 只列試聽', async () => {
    expect(await ids(await call(seed(), '/?kind=trial'))).toEqual([id(6)]);
  });

  it('分校受限：報名看班的分校、試聽看課程的分校', async () => {
    expect(await ids(await call(seed(), '/', {}, [CAMPUS_A]))).toEqual([id(2), id(1)]);
    expect(await ids(await call(seed(), '/', {}, [CAMPUS_B]))).toEqual([id(6)]);
    expect(await ids(await call(seed(), '/', {}, []))).toEqual([]);
  });

  it('不合法的 group：400', async () => {
    expect((await call(seed(), '/?group=nope')).status).toBe(400);
  });
});

describe('PATCH /api/parent-requests/:kind/:id', () => {
  const patch = (
    db: ReturnType<typeof seed>,
    path: string,
    body: unknown,
    scope: readonly string[] | null = null,
  ) =>
    call(
      db,
      path,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      scope,
    );
  const row = (db: ReturnType<typeof seed>, table: string, n: number) =>
    db.rows(table).find((r) => r['id'] === id(n))!;

  it('拒絕報名：要寫原因（家長看得到），記稽核（前後值）', async () => {
    const db = seed();
    const res = await patch(db, `/enrollment/${id(2)}`, {
      status: 'rejected',
      rejectReason: '這班已經額滿，下學期再開',
    });

    expect(res.status).toBe(200);
    expect(row(db, 'enrollment_requests', 2)).toMatchObject({
      status: 'rejected',
      reject_reason: '這班已經額滿，下學期再開',
    });
    const [audit] = db.rows('audit_logs');
    expect(audit).toMatchObject({
      resource_type: 'enrollment_request',
      resource_id: id(2),
      action: 'update',
    });
    expect(JSON.stringify(audit!['details'])).toContain('waitlist');
  });

  // 審核席 #1728：update 也要帶 org_id（c1）。別 org 塞一筆同 id 的列，它不能被改到
  it('寫入也帶 org_id：別 org 同 id 的列不會被改到', async () => {
    const db = seed([enrollment(1, { org_id: ORG_B })]);
    const res = await patch(db, `/enrollment/${id(1)}`, { status: 'rejected', rejectReason: 'x' });
    expect(res.status).toBe(200);
    const rows = db.rows('enrollment_requests').filter((r) => r['id'] === id(1));
    expect(rows.find((r) => r['org_id'] === ORG)!['status']).toBe('rejected');
    expect(rows.find((r) => r['org_id'] === ORG_B)!['status']).toBe('pending');
  });

  // 審核席 #1728：讀完到寫入之間被別人核准了（#1726 上線後會發生）—— 不能蓋掉已開帳單的那一筆
  it('讀完之後被搶先核准：409，不蓋掉', async () => {
    const db = seed();
    const client = db.client as { from: (t: string) => any };
    const from = client.from.bind(client);
    let calls = 0;
    client.from = (t: string) => {
      // 第 2 次碰這張表＝route 要寫入了；先讓「別人」把它核准
      if (t === 'enrollment_requests' && ++calls === 2) {
        void from(t)
          .update({ status: 'awaiting_payment' })
          .eq('id', id(1))
          .then(() => undefined);
      }
      return from(t);
    };
    const res = await patch(db, `/enrollment/${id(1)}`, { status: 'rejected', rejectReason: 'x' });
    const row = db.rows('enrollment_requests').find((r) => r['id'] === id(1))!;
    expect(row['status']).toBe('awaiting_payment');
    expect(res.status).toBe(409);
    expect(row['reject_reason']).toBeNull();
    expect(db.rows('audit_logs')).toHaveLength(0);
  });

  it('拒絕沒寫原因：400，沒改', async () => {
    const db = seed();
    for (const body of [{ status: 'rejected' }, { status: 'rejected', rejectReason: '  ' }]) {
      expect((await patch(db, `/enrollment/${id(1)}`, body)).status).toBe(400);
    }
    expect(row(db, 'enrollment_requests', 1)['status']).toBe('pending');
  });

  it('報名只能拒絕：其他狀態（核准是另一張單，金額路徑）400', async () => {
    const db = seed();
    // 帶著原因：不然是「缺原因」那條擋下來的，測不到「只能拒絕」
    const res = await patch(db, `/enrollment/${id(1)}`, {
      status: 'awaiting_payment',
      rejectReason: 'x',
    });
    expect(res.status).toBe(400);
    expect(row(db, 'enrollment_requests', 1)['status']).toBe('pending');
  });

  it('已核准待繳費（有帳單了）不能拒絕：409', async () => {
    const db = seed();
    const res = await patch(db, `/enrollment/${id(3)}`, {
      status: 'rejected',
      rejectReason: 'x',
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).code).toBe('NOT_REJECTABLE');
    expect(row(db, 'enrollment_requests', 3)['status']).toBe('awaiting_payment');
  });

  it('試聽：排定、完成、取消都可以，誤標也改得回來；記稽核', async () => {
    const db = seed();
    for (const status of ['scheduled', 'completed', 'pending', 'cancelled']) {
      expect((await patch(db, `/trial/${id(6)}`, { status })).status).toBe(200);
      expect(row(db, 'trial_requests', 6)['status']).toBe(status);
    }
    expect(db.rows('audit_logs').every((a) => a['resource_type'] === 'trial_request')).toBe(true);
    expect(db.rows('audit_logs')).toHaveLength(4);
  });

  it('試聽不收拒絕原因、不收不存在的狀態：400', async () => {
    const db = seed();
    expect((await patch(db, `/trial/${id(6)}`, { status: 'rejected' })).status).toBe(400);
  });

  it('範圍外、別 org、不存在：404 NOT_FOUND，沒改', async () => {
    const db = seed();
    const cases: [string, readonly string[] | null][] = [
      [`/enrollment/${id(1)}`, [CAMPUS_B]],
      [`/trial/${id(6)}`, [CAMPUS_A]],
      [`/enrollment/${id(5)}`, null],
      [`/enrollment/${id(99)}`, null],
    ];
    for (const [path, scope] of cases) {
      const body = path.startsWith('/trial')
        ? { status: 'cancelled' }
        : { status: 'rejected', rejectReason: 'x' };
      const res = await patch(db, path, body, scope);
      expect(res.status).toBe(404);
      expect(((await res.json()) as any).code).toBe('NOT_FOUND');
    }
    expect(db.rows('audit_logs')).toHaveLength(0);
  });
});
