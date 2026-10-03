import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../../test-utils/multi-org-db';
import { publicOrgMiddleware } from '../../lib/public-org';
import trialRoute from './trial-applications';

/**
 * #1124：公開試聽申請（免登入）。同 #1123 寫進 `public_applications`（`kind='trial'`），不寫 `trial_requests`。
 * 課程要有至少一個公開開放中的班 —— 沒有開放班的課程試聽不了。試聽沒有候補。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const TODAY = '2026-10-04';

const COURSE_OPEN = id(21);
const COURSE_ONLY_ENDED = id(22);
const COURSE_INACTIVE = id(23);
const COURSE_ORG_B = id(24);
const COURSE_NO_CLASS = id(25);

const cls = (cid: string, courseId: string, extra: Record<string, unknown> = {}) => ({
  id: cid,
  org_id: ORG,
  course_id: courseId,
  is_active: true,
  end_date: null,
  courses: { is_active: true },
  ...extra,
});

function seed() {
  return createMultiOrgDb({
    organizations: [{ id: ORG, slug: 'demo' }],
    courses: [
      { id: COURSE_OPEN, org_id: ORG, is_active: true },
      { id: COURSE_ONLY_ENDED, org_id: ORG, is_active: true },
      { id: COURSE_INACTIVE, org_id: ORG, is_active: false },
      { id: COURSE_ORG_B, org_id: ORG_B, is_active: true },
      { id: COURSE_NO_CLASS, org_id: ORG, is_active: true },
    ],
    classes: [
      cls(id(11), COURSE_OPEN),
      cls(id(12), COURSE_ONLY_ENDED, { end_date: '2026-10-03' }),
      cls(id(13), COURSE_INACTIVE, { courses: { is_active: false } }),
      cls(id(14), COURSE_ORG_B, { org_id: ORG_B }),
    ],
    public_applications: [],
    public_application_targets: [],
  });
}

const body = (extra: Record<string, unknown> = {}) => ({
  parent: { name: '林爸爸', email: 'dad@example.test', relation: 'father' },
  student: { name: '林小美', grade: 'P5', school: '信義國小' },
  courseIds: [COURSE_OPEN],
  consent: true,
  ...extra,
});

async function post(db: ReturnType<typeof seed>, payload: unknown, slug = 'demo') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set('supabase', db.client);
    await next();
  });
  app.use('*', publicOrgMiddleware);
  app.route('/', trialRoute as unknown as Hono);
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

describe('POST /api/public/trial-applications', () => {
  it('寫 kind=trial 的申請＋每門課一列（course_id、沒有候補）', async () => {
    const db = seed();
    const { res, json } = await post(db, body({ preferredTimes: ' 週三晚上 ' }));

    expect(res.status).toBe(201);
    const [app] = db.rows('public_applications');
    expect(app).toMatchObject({
      org_id: ORG,
      kind: 'trial',
      parent_email: 'dad@example.test',
      parent_phone: null,
      student_grade: 'P5',
      preferred_times: '週三晚上',
      preferred_start_date: null,
    });
    expect(json).toEqual({ id: app!['id'] });
    expect(
      db
        .rows('public_application_targets')
        .map((t) => [t['course_id'], t['class_id'], t['is_waitlist']]),
    ).toEqual([[COURSE_OPEN, null, false]]);
  });

  it.each([
    ['只有已結束班的課程', COURSE_ONLY_ENDED],
    ['停用的課程', COURSE_INACTIVE],
    ['別 org 的課程', COURSE_ORG_B],
    ['沒有任何班的課程', COURSE_NO_CLASS],
  ])('%s：400 INVALID_COURSE，整筆不寫', async (_label, courseId) => {
    const db = seed();
    const { res, json } = await post(db, body({ courseIds: [COURSE_OPEN, courseId] }));

    expect(res.status).toBe(400);
    expect(json.code).toBe('INVALID_COURSE');
    expect(db.rows('public_applications')).toHaveLength(0);
  });

  it('聯絡方式、同意、空清單、未開放：跟報名同一套檢查', async () => {
    expect(
      (await post(seed(), body({ parent: { name: '林爸爸', relation: 'father' } }))).json.code,
    ).toBe('EMAIL_OR_PHONE_REQUIRED');
    expect((await post(seed(), body({ consent: false }))).res.status).toBe(400);
    expect((await post(seed(), body({ courseIds: [] }))).res.status).toBe(400);
    expect((await post(seed(), body(), '')).json.code).toBe('PUBLIC_DISABLED');
  });
});
