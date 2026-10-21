import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CampusScope } from '../lib/campus-scope';
import { loadLeaveStreaks, type ReviewedLeaveStreak } from '../lib/leave-streak';
import { createMultiOrgDb } from '../test-utils/multi-org-db';
import leaveStreaksApp from './leave-streaks';

// 偵測演算法由 lib/leave-streak.spec 守、真 DB 由 contract 守；這裡只測授權、範圍與已處理的寫入
vi.mock('../lib/leave-streak', async (importActual) => ({
  ...(await importActual<typeof import('../lib/leave-streak')>()),
  loadLeaveStreaks: vi.fn(),
}));
const load = vi.mocked(loadLeaveStreaks);
afterEach(() => load.mockReset());

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const STU = '33333333-3333-4333-8333-333333333333';
const STU2 = '44444444-4444-4444-8444-444444444444';
const ALIEN = '55555555-5555-4555-8555-555555555555';
const REVIEW = '66666666-6666-4666-8666-666666666666';
const ALIEN_REVIEW = '77777777-7777-4777-8777-777777777777';

const streak = (firstDay: string, lastDay: string, review = false): ReviewedLeaveStreak => ({
  firstDay,
  lastDay,
  days: [firstDay, lastDay].map((date) => ({
    date,
    sessions: [
      {
        sessionId: `s-${date}`,
        classId: 'class-1',
        className: '國二數學',
        campusId: 'campus-1',
        date,
        startTime: '18:00',
        endTime: '20:00',
        attended: false,
      },
    ],
  })),
  review: review
    ? { id: REVIEW, first_day: firstDay, last_day: lastDay, reviewed_by: 'u', reviewed_at: 't' }
    : null,
});
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const D1 = addDays(today, -3);
const D2 = addDays(today, -1);

function seed() {
  return createMultiOrgDb({
    students: [
      {
        id: STU,
        org_id: ORG,
        name: '林小華',
        enrollments: [{ classes: { campus_id: 'campus-1' } }],
      },
      {
        id: STU2,
        org_id: ORG,
        name: '王小明',
        enrollments: [{ classes: { campus_id: 'campus-2' } }],
      },
      { id: ALIEN, org_id: OTHER, name: '別家', enrollments: [{ classes: { campus_id: 'x' } }] },
    ],
    leave_streak_reviews: [
      { id: REVIEW, org_id: ORG, student_id: STU, first_day: D1, last_day: D2 },
      // 別 org 的列、student_id 撞上本 org 的學生（c1：刪除只看 student_id 會刪到它）
      { id: ALIEN_REVIEW, org_id: OTHER, student_id: STU, first_day: D1, last_day: D2 },
    ],
    meal_records: [
      {
        org_id: ORG,
        student_id: STU,
        meal_date: D1,
        ordered: true,
        chargeable: true,
        unit_price: 80,
        invoice_items: { period_month: '2026-10' },
      },
      {
        org_id: ORG,
        student_id: STU,
        meal_date: D2,
        ordered: true,
        chargeable: false,
        unit_price: 80,
        invoice_items: null,
      },
    ],
    enrollments: [
      {
        org_id: ORG,
        student_id: STU,
        class_id: 'class-1',
        status: 'active',
        billing_mode: 'session_pack',
        effective_from: '2026-01-01',
        effective_to: null,
        classes: { name: '國二數學', leave_deducts_session: true },
      },
    ],
    staff: [
      { user_id: 'u', org_id: ORG, display_name: '王主任' },
      { user_id: 'u', org_id: OTHER, display_name: '別家的人' },
    ],
    ba_user: [
      { id: 'u', name: '帳號名' },
      { id: 'u-outsider', name: 'Demo Admin' },
    ],
    audit_logs: [],
  });
}

/** 某張表的查詢一律回錯（其餘照替身） */
function failingOn(db: ReturnType<typeof createMultiOrgDb>, table: string) {
  const client = db.client as { from: (t: string) => unknown };
  const failed = { data: null, error: { code: 'XX000', message: 'boom' } };
  const chain: unknown = new Proxy(() => chain, {
    get: (_t, prop) =>
      prop === 'then' ? (ok: (v: unknown) => unknown) => ok(failed) : () => chain,
  });
  return { ...db, client: { from: (t: string) => (t === table ? chain : client.from(t)) } };
}

function appWith(db: ReturnType<typeof createMultiOrgDb>, scope: CampusScope = null) {
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('campusScope', scope);
    set('userId', 'user-1');
    set('roles', ['admin']);
    await next();
  });
  app.route('/api/leave-streaks', leaveStreaksApp);
  return app;
}

describe('GET /api/leave-streaks?studentIds=（帳單頁）', () => {
  it('只問本 org、範圍內的學生；只回未處理的段', async () => {
    load.mockResolvedValue({
      threshold: 3,
      byStudent: new Map([
        [STU, [streak(D1, D2), streak(addDays(D1, -20), addDays(D1, -18), true)]],
      ]),
    });
    const res = await appWith(seed(), ['campus-1']).request(
      `/api/leave-streaks?studentIds=${STU},${STU2},${ALIEN}`,
    );
    expect(res.status).toBe(200);
    expect(load.mock.calls[0]![2]).toEqual([STU]);
    expect(await res.json()).toEqual({
      data: [{ studentId: STU, firstDay: D1, lastDay: D2, days: 2 }],
    });
  });

  it('不分校受限也只問本 org 的學生（c1）', async () => {
    load.mockResolvedValue({ threshold: 3, byStudent: new Map() });
    await appWith(seed()).request(`/api/leave-streaks?studentIds=${STU},${ALIEN}`);
    expect(load.mock.calls[0]![2]).toEqual([STU]);
  });

  it('超過 100 個或不是 uuid：400', async () => {
    const many = Array.from({ length: 101 }, () => crypto.randomUUID()).join(',');
    expect((await appWith(seed()).request(`/api/leave-streaks?studentIds=${many}`)).status).toBe(
      400,
    );
    expect((await appWith(seed()).request('/api/leave-streaks?studentIds=abc')).status).toBe(400);
  });
});

describe('GET /api/leave-streaks/students/:id（學生檔案明細）', () => {
  it('別 org、範圍外：404（不查）', async () => {
    expect((await appWith(seed()).request(`/api/leave-streaks/students/${ALIEN}`)).status).toBe(
      404,
    );
    expect(
      (await appWith(seed(), ['campus-1']).request(`/api/leave-streaks/students/${STU2}`)).status,
    ).toBe(404);
    expect(load).not.toHaveBeenCalled();
  });

  it('明細：只列訂了而且收費的餐（含已開在哪個月）、報名的計費方式與扣不扣堂', async () => {
    load.mockResolvedValue({ threshold: 3, byStudent: new Map([[STU, [streak(D1, D2)]]]) });
    const res = await appWith(seed()).request(`/api/leave-streaks/students/${STU}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { threshold: number; data: Array<Record<string, unknown>> };
    expect(body.threshold).toBe(3);
    expect(body.data[0]).toMatchObject({
      firstDay: D1,
      lastDay: D2,
      meals: [{ date: D1, unitPrice: 80, invoicedMonth: '2026-10' }],
      enrollments: [
        {
          classId: 'class-1',
          className: '國二數學',
          billingMode: 'session_pack',
          leaveDeductsSession: true,
          sessionCount: 2,
        },
      ],
      review: null,
    });
  });
});

describe('GET /api/leave-streaks/students/:id —— 已處理的段帶標的人（§4.1「王主任 10/20」）', () => {
  it('reviewerName 讀本 org 的教職員名', async () => {
    load.mockResolvedValue({ threshold: 3, byStudent: new Map([[STU, [streak(D1, D2, true)]]]) });
    const res = await appWith(seed()).request(`/api/leave-streaks/students/${STU}`);
    const body = (await res.json()) as { data: Array<{ review: unknown }> };
    expect(body.data[0]!.review).toEqual({
      id: REVIEW,
      reviewedBy: 'u',
      reviewerName: '王主任',
      reviewedAt: 't',
    });
  });
});

describe('GET /api/leave-streaks/students/:id —— 標的人不是本機構教職員', () => {
  it.each(['ba_user', 'staff'])(
    '標的人名字查詢失敗（%s）：500，不默默少一個名字（#1741 二讀）',
    async (table) => {
      load.mockResolvedValue({ threshold: 3, byStudent: new Map([[STU, [streak(D1, D2, true)]]]) });
      const res = await appWith(failingOn(seed(), table)).request(
        `/api/leave-streaks/students/${STU}`,
      );
      expect(res.status).toBe(500);
    },
  );

  it('退回帳號名（ba_user.name）', async () => {
    const reviewed = streak(D1, D2, true);
    load.mockResolvedValue({
      threshold: 3,
      byStudent: new Map([
        [STU, [{ ...reviewed, review: { ...reviewed.review!, reviewed_by: 'u-outsider' } }]],
      ]),
    });
    const res = await appWith(seed()).request(`/api/leave-streaks/students/${STU}`);
    const body = (await res.json()) as { data: Array<{ review: { reviewerName: string } }> };
    expect(body.data[0]!.review.reviewerName).toBe('Demo Admin');
  });
});

describe('POST /api/leave-streaks/students/:id/reviews（標為已處理）', () => {
  const post = (db: ReturnType<typeof createMultiOrgDb>, id: string, body: object) =>
    appWith(db).request(`/api/leave-streaks/students/${id}/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('伺服器重算：不是現存的達標段 → 409，不寫', async () => {
    const db = seed();
    load.mockResolvedValue({ threshold: 3, byStudent: new Map([[STU, [streak(D1, D2)]]]) });
    const res = await post(db, STU, { firstDay: D1, lastDay: addDays(D2, 1) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('STREAK_NOT_FOUND');
    expect(db.rows('leave_streak_reviews')).toHaveLength(2);
  });

  it('現存而且未處理 → 201，寫一列＋稽核（reviewed_by 會被 SET NULL，誰標的以稽核為準）', async () => {
    const db = seed();
    const first = addDays(D1, -10);
    const last = addDays(D1, -8);
    load.mockResolvedValue({ threshold: 3, byStudent: new Map([[STU, [streak(first, last)]]]) });
    const res = await post(db, STU, { firstDay: first, lastDay: last });
    expect(res.status).toBe(201);
    expect(db.rows('leave_streak_reviews').at(-1)).toMatchObject({
      org_id: ORG,
      student_id: STU,
      first_day: first,
      last_day: last,
      reviewed_by: 'user-1',
    });
    await vi.waitFor(() =>
      expect(db.rows('audit_logs')).toContainEqual(
        expect.objectContaining({ action: 'mark_leave_streak_reviewed', resource_id: STU }),
      ),
    );
  });

  it('已經被涵蓋 → 409 ALREADY_REVIEWED', async () => {
    load.mockResolvedValue({ threshold: 3, byStudent: new Map([[STU, [streak(D1, D2, true)]]]) });
    const res = await post(seed(), STU, { firstDay: D1, lastDay: D2 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('ALREADY_REVIEWED');
  });

  it('別 org 的學生：404', async () => {
    expect((await post(seed(), ALIEN, { firstDay: D1, lastDay: D2 })).status).toBe(404);
  });
});

describe('DELETE /api/leave-streaks/students/:id/reviews/:reviewId（復原）', () => {
  const del = (db: ReturnType<typeof createMultiOrgDb>, id: string, reviewId: string) =>
    appWith(db).request(`/api/leave-streaks/students/${id}/reviews/${reviewId}`, {
      method: 'DELETE',
    });

  it('刪掉那一列＋稽核', async () => {
    const db = seed();
    expect((await del(db, STU, REVIEW)).status).toBe(204);
    expect(db.rows('leave_streak_reviews')).toHaveLength(1);
    await vi.waitFor(() =>
      expect(db.rows('audit_logs')).toContainEqual(
        expect.objectContaining({ action: 'unmark_leave_streak_reviewed' }),
      ),
    );
  });

  it('別 org 的列（student_id 一樣）：404，不刪（c1）', async () => {
    const db = seed();
    expect((await del(db, STU, ALIEN_REVIEW)).status).toBe(404);
    expect(db.rows('leave_streak_reviews').map((r) => r['id'])).toContain(ALIEN_REVIEW);
  });

  it('掛在別的學生名下：404，不刪', async () => {
    const db = seed();
    expect((await del(db, STU2, REVIEW)).status).toBe(404);
    expect(db.rows('leave_streak_reviews')).toHaveLength(2);
  });
});
