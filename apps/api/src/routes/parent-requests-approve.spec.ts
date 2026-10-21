import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';

/**
 * #1726：`POST /api/parent-requests/enrollment/{id}/approve` 的路由層 —— 權限、範圍、撞課、
 * 交易結果怎麼對成 HTTP。交易本身（全有或全無、名額、帳單）在
 * `contract/enrollment-approve.contract.ts` 對真 Postgres 驗，這裡替身掉。
 */

const h = vi.hoisted(() => ({
  pool: {} as unknown,
  approve: vi.fn(),
  conflicts: [] as unknown[],
  notify: vi.fn(async () => undefined),
}));
vi.mock('../lib/notify-events', () => ({ notifyEnrollmentApproved: h.notify }));
vi.mock('../lib/get-auth', () => ({ getAuth: () => ({ pool: h.pool }) }));
vi.mock('../lib/enrollment-approve', () => ({ approveEnrollmentRequest: h.approve }));
vi.mock('./enrollments/validation', () => ({
  checkEnrollmentPreconditions: async () => ({ error: null, conflicts: h.conflicts }),
}));

const { default: parentRequestsRoute } = await import('./parent-requests');

const ORG = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const REQ = '00000000-0000-0000-0000-000000000001';
const OTHER_ORG_REQ = '00000000-0000-0000-0000-000000000002';
const TPL = '00000000-0000-0000-0000-0000000000f1';

const request = (id: string, org: string) => ({
  id,
  org_id: org,
  student_id: 'stu-1',
  class_id: 'cls-1',
  status: 'pending',
  requested_by: 'user-parent-1',
  created_at: '2026-10-01T00:00:00Z',
  students: { name: '林小華' },
  classes: { name: '國二數學 A', campus_id: 'campus-a', campuses: { name: '信義分校' } },
});

const BODY = { billingMode: 'monthly', feeTemplateId: TPL, effectiveFrom: '2026-11-01' };
const DONE = {
  status: 'done',
  studentId: 'stu-1',
  classId: 'cls-1',
  enrollmentId: 'enr-1',
  invoiceId: 'inv-1',
  invoiceNo: 'INV-0001',
  amount: 3100,
  dueDate: '2026-11-04',
};

function call(
  opts: {
    id?: string;
    body?: unknown;
    permissions?: string[];
    scope?: readonly string[] | null;
    /** 讀申請那一句回 DB 錯誤 */
    failRead?: boolean;
  } = {},
) {
  const db = createMultiOrgDb({
    enrollment_requests: [request(REQ, ORG), request(OTHER_ORG_REQ, ORG_B)],
    audit_logs: [],
    profiles: [],
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    const failing = {
      select: () => failing,
      eq: () => failing,
      maybeSingle: async () => ({ data: null, error: { message: 'boom' } }),
    };
    set(
      'supabase',
      opts.failRead
        ? {
            from: (t: string) =>
              t === 'enrollment_requests'
                ? failing
                : (db.client as { from: (t: string) => unknown }).from(t),
          }
        : db.client,
    );
    set('orgId', ORG);
    set('userId', 'admin-1');
    set('roles', ['admin']);
    set('permissions', opts.permissions ?? ['manage_students', 'manage_finance']);
    set('campusScope', opts.scope === undefined ? null : opts.scope);
    await next();
  });
  app.route('/', parentRequestsRoute as unknown as Hono);
  const res = app.request(
    `/enrollment/${opts.id ?? REQ}/approve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts.body ?? BODY),
    },
    {},
    { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
  );
  return { res, db };
}

const json = async (r: Response | Promise<Response>) => {
  const res = await r;
  return { status: res.status, body: (await res.json()) as any };
};

describe('POST /api/parent-requests/enrollment/{id}/approve（#1726）', () => {
  beforeEach(() => {
    h.pool = {};
    h.conflicts = [];
    h.approve.mockReset();
    h.approve.mockResolvedValue(DONE);
    h.notify.mockClear();
  });

  it('核准成功 → 200 帶帳單編號與金額；交易拿到本 org、範圍、台北開帳日', async () => {
    const { status, body } = await json(call().res);
    expect(status).toBe(200);
    expect(body.data).toEqual({
      enrollmentId: 'enr-1',
      invoiceId: 'inv-1',
      invoiceNo: 'INV-0001',
      amount: 3100,
      dueDate: '2026-11-04',
    });
    expect(h.approve).toHaveBeenCalledWith(
      h.pool,
      expect.objectContaining({
        orgId: ORG,
        requestId: REQ,
        scope: null,
        billingMode: 'monthly',
        feeTemplateId: TPL,
        issuedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it('核准成功才通知家長（Q1 (b)）：帶學生、班、金額、期限、申請 id', async () => {
    await call().res;
    expect(h.notify).toHaveBeenCalledWith(expect.anything(), {
      orgId: ORG,
      requestId: REQ,
      studentId: 'stu-1',
      studentName: '林小華',
      className: '國二數學 A',
      amount: 3100,
      dueDate: '2026-11-04',
    });

    h.notify.mockClear();
    h.approve.mockResolvedValue({ status: 'class-full' });
    await call().res;
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('核准記一筆稽核：action approve，帶帳單與金額', async () => {
    const { res, db } = call();
    await res;
    await new Promise((r) => setTimeout(r, 0));
    const rows = db.rows('audit_logs') as Array<Record<string, any>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'approve',
      resource_type: 'enrollment_request',
      resource_id: REQ,
    });
    expect(rows[0]!['details']).toMatchObject({ invoice_id: 'inv-1', amount: 3100 });
  });

  it('沒有 manage_finance → 403，不碰交易（Q6）', async () => {
    const { status, body } = await json(call({ permissions: ['manage_students'] }).res);
    expect(status).toBe(403);
    expect(body.code).toBe('FINANCE_REQUIRED');
    expect(h.approve).not.toHaveBeenCalled();
  });

  it('pg 池不在 → 500，不退回沒有交易的寫法', async () => {
    h.pool = null;
    const { status, body } = await json(call().res);
    expect(status).toBe(500);
    expect(body.code).toBe('DB_POOL_UNAVAILABLE');
    expect(h.approve).not.toHaveBeenCalled();
  });

  it('別 org 的申請 → 404，不碰交易（c1）', async () => {
    const { status } = await json(call({ id: OTHER_ORG_REQ }).res);
    expect(status).toBe(404);
    expect(h.approve).not.toHaveBeenCalled();
  });

  it('班不在分校範圍 → 404，不碰交易', async () => {
    const { status } = await json(call({ scope: ['campus-b'] }).res);
    expect(status).toBe(404);
    expect(h.approve).not.toHaveBeenCalled();
  });

  it('撞課 → 409 列出衝突；勾了 skipConflictCheck 才核准', async () => {
    h.conflicts = [{ studentId: 'stu-1', conflictingClassName: '國二英文' }];
    const blocked = await json(call().res);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('SCHEDULE_CONFLICT');
    expect(h.approve).not.toHaveBeenCalled();

    const ok = await json(call({ body: { ...BODY, skipConflictCheck: true } }).res);
    expect(ok.status).toBe(200);
  });

  it.each([
    [{ status: 'not-found' }, 404, 'NOT_FOUND'],
    [{ status: 'not-approvable', current: 'awaiting_payment' }, 409, 'NOT_APPROVABLE'],
    [{ status: 'class-full' }, 409, 'CLASS_FULL'],
    [{ status: 'already-enrolled' }, 409, 'ALREADY_ENROLLED'],
    [{ status: 'no-billing-period' }, 409, 'NO_BILLING_PERIOD'],
    [{ status: 'invalid-fee-template' }, 400, 'INVALID_FEE_TEMPLATE'],
    [{ status: 'zero-amount' }, 400, 'ZERO_AMOUNT'],
  ])('交易結果 %o → %i %s', async (outcome, http, code) => {
    h.approve.mockResolvedValue(outcome);
    const { status, body } = await json(call().res);
    expect(status).toBe(http);
    expect(body.code).toBe(code);
  });

  it('改了金額沒寫原因 → 400 並帶回試算值', async () => {
    h.approve.mockResolvedValue({ status: 'amount-note-required', suggested: 1000 });
    const { status, body } = await json(call({ body: { ...BODY, amount: 900 } }).res);
    expect(status).toBe(400);
    expect(body).toMatchObject({ code: 'AMOUNT_NOTE_REQUIRED', details: { suggested: 1000 } });
  });

  it('交易丟例外 → 500，不是 404', async () => {
    h.approve.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await call().res).status).toBe(500);
  });

  it('繳費期限早於開帳日 → 400，不碰交易', async () => {
    const { status, body } = await json(call({ body: { ...BODY, dueDate: '2000-01-01' } }).res);
    expect(status).toBe(400);
    expect(body.code).toBe('DUE_BEFORE_ISSUE');
    expect(h.approve).not.toHaveBeenCalled();
  });

  it('讀申請失敗 → 500，不是 404', async () => {
    const { status, body } = await json(call({ failRead: true }).res);
    expect(status).toBe(500);
    expect(body.code).toBe('SERVER_ERROR');
    expect(h.approve).not.toHaveBeenCalled();
  });

  it('議定金額沒寫原因、堂數制沒填堂數 → 400（不碰交易）', async () => {
    expect((await call({ body: { ...BODY, agreedAmount: 2500 } }).res).status).toBe(400);
    expect((await call({ body: { ...BODY, billingMode: 'session_pack' } }).res).status).toBe(400);
    expect(h.approve).not.toHaveBeenCalled();
  });
});
