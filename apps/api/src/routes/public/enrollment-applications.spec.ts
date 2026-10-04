import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../../test-utils/multi-org-db';
import { publicOrgMiddleware } from '../../lib/public-org';
import applicationsRoute from './enrollment-applications';

/**
 * #1123：公開報名送出（免登入）。寫進 `public_applications`（未驗證的申請），不建家長、學生、帳號 ——
 * 那是首次收款時的事（rules/enrollment-rules.md 1.4）。班與額滿一律伺服器判定，不信前端。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const TODAY = '2026-10-04';

const cls = (cid: string, extra: Record<string, unknown> = {}) => ({
  id: cid,
  org_id: ORG,
  name: `班 ${cid.slice(-2)}`,
  max_students: 2,
  is_active: true,
  end_date: null,
  courses: { is_active: true },
  ...extra,
});

function seed() {
  return createMultiOrgDb({
    organizations: [{ id: ORG, slug: 'demo' }],
    classes: [
      cls(id(11)),
      cls(id(12)), // 額滿
      cls(id(13), { is_active: false }),
      cls(id(14), { end_date: '2026-10-03' }),
      cls(id(15), { courses: { is_active: false } }),
      cls(id(16), { org_id: ORG_B }),
    ],
    enrollments: [
      { org_id: ORG, class_id: id(12), student_id: 's1', status: 'active' },
      { org_id: ORG, class_id: id(12), student_id: 's2', status: 'pending_payment' },
      { org_id: ORG, class_id: id(11), student_id: 's3', status: 'withdrawn' },
    ],
    public_applications: [],
    public_application_targets: [],
  });
}

const body = (extra: Record<string, unknown> = {}) => ({
  parent: { name: ' 王媽媽 ', phone: '0912-345-678', relation: 'mother' },
  student: { name: '王小明', grade: 'J2', school: '信義國中' },
  classIds: [id(11)],
  consent: true,
  ...extra,
});

async function post(
  db: ReturnType<typeof seed>,
  payload: unknown,
  slug: string | undefined = 'demo',
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set('supabase', db.client);
    await next();
  });
  app.use('*', publicOrgMiddleware);
  app.route('/', applicationsRoute as unknown as Hono);
  const res = await app.request(
    '/',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    { PUBLIC_ORG_SLUG: slug },
  );
  return { res, json: (await res.json()) as any };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T04:00:00Z`));
});
afterEach(() => vi.useRealTimers());

describe('POST /api/public/enrollment-applications', () => {
  it('寫一筆申請＋每班一列；手機去掉分隔、名字 trim、同意時間是伺服器時間', async () => {
    const db = seed();
    const { res, json } = await post(db, body({ classIds: [id(11), id(12)], note: '想週三上課' }));

    expect(res.status).toBe(201);
    const [app] = db.rows('public_applications');
    expect(app).toMatchObject({
      org_id: ORG,
      kind: 'enrollment',
      parent_name: '王媽媽',
      parent_phone: '0912345678',
      parent_email: null,
      parent_relation: 'mother',
      student_grade: 'J2',
      note: '想週三上課',
      consented_at: `${TODAY}T04:00:00.000Z`,
    });
    expect(json).toEqual({ id: app!['id'], waitlistClassIds: [id(12)] });
    const targets = db.rows('public_application_targets');
    expect(targets.map((t) => [t['class_id'], t['is_waitlist']])).toEqual([
      [id(11), false],
      [id(12), true], // 額滿：上限 2、active＋pending_payment 2（withdrawn 不算）
    ]);
    expect(targets.every((t) => t['application_id'] === app!['id'])).toBe(true);
  });

  it.each([
    ['別 org 的班', id(16)],
    ['停用的班', id(13)],
    ['已結束的班', id(14)],
    ['課程停用的班', id(15)],
    ['不存在的班', id(99)],
  ])('%s：400 INVALID_CLASS，整筆不寫', async (_label, classId) => {
    const db = seed();
    const { res, json } = await post(db, body({ classIds: [id(11), classId] }));

    expect(res.status).toBe(400);
    expect(json.code).toBe('INVALID_CLASS');
    expect(db.rows('public_applications')).toHaveLength(0);
    expect(db.rows('public_application_targets')).toHaveLength(0);
  });

  it('沒有 email 也沒有手機：400 EMAIL_OR_PHONE_REQUIRED', async () => {
    const { res, json } = await post(
      seed(),
      body({ parent: { name: '王媽媽', relation: 'mother' } }),
    );

    expect(res.status).toBe(400);
    expect(json.code).toBe('EMAIL_OR_PHONE_REQUIRED');
  });

  it('手機格式不對：400（zod）', async () => {
    const { res } = await post(
      seed(),
      body({ parent: { name: '王媽媽', phone: '12345', relation: 'mother' } }),
    );

    expect(res.status).toBe(400);
  });

  it('沒勾同意：400，不寫', async () => {
    const db = seed();
    const { res } = await post(db, body({ consent: false }));

    expect(res.status).toBe(400);
    expect(db.rows('public_applications')).toHaveLength(0);
  });

  it('沒選班：400', async () => {
    const { res } = await post(seed(), body({ classIds: [] }));

    expect(res.status).toBe(400);
  });

  it('部署沒開公開頁：404 PUBLIC_DISABLED，不寫', async () => {
    const db = seed();
    const { res, json } = await post(db, body(), ''); // 空字串＝設了但沒填（undefined 會吃到參數預設值 demo）

    expect(res.status).toBe(404);
    expect(json.code).toBe('PUBLIC_DISABLED');
    expect(db.rows('public_applications')).toHaveLength(0);
  });
});
