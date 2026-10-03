import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../../test-utils/multi-org-db';
import { publicOrgMiddleware } from '../../lib/public-org';
import publicCatalogRoute from './catalog';

/**
 * #1125：公開課程目錄（免登入）。org 不從網址來，從部署設定 `PUBLIC_ORG_SLUG`（c12：一部署一客戶）；
 * 沒設就 404 —— 沒準備好招生的客戶不會不小心開著。斷言一律寫 `code`。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const TODAY = '2026-10-04';

const course = (extra: Record<string, unknown> = {}) => ({
  id: 'course-1',
  name: '國中數學',
  description: '會考衝刺',
  is_active: true,
  subjects: { name: '數學' },
  ...extra,
});

function cls(cid: string, extra: Record<string, unknown> = {}) {
  return {
    id: cid,
    org_id: ORG,
    name: `班 ${cid.slice(-2)}`,
    grade_levels: ['junior_2'],
    max_students: 3,
    is_active: true,
    end_date: null,
    courses: course(),
    campuses: { name: '信義校' },
    schedules: [
      {
        weekday: 2,
        start_time: '18:00:00',
        end_time: '20:00:00',
        effective_to: null,
        teacher: { display_name: '王老師' },
      },
    ],
    fee_template: null,
    ...extra,
  };
}

const enrollment = (classId: string, status: string, org = ORG) => ({
  org_id: org,
  class_id: classId,
  student_id: `s-${Math.random()}`,
  status,
});

function seed() {
  return createMultiOrgDb({
    organizations: [
      { id: ORG, slug: 'demo' },
      { id: ORG_B, slug: 'other' },
    ],
    classes: [
      cls(id(11), {
        fee_template: { amount: 4500, billing_mode: 'monthly', is_active: true },
      }),
      cls(id(12), { fee_template: { amount: 9000, billing_mode: 'period', is_active: false } }),
      cls(id(13), { is_active: false }),
      cls(id(14), { end_date: '2026-10-03' }),
      cls(id(15), { courses: course({ is_active: false }) }),
      cls(id(16), { org_id: ORG_B }),
    ],
    enrollments: [
      enrollment(id(11), 'active'),
      enrollment(id(11), 'pending_payment'),
      enrollment(id(11), 'withdrawn'),
      enrollment(id(11), 'active', ORG_B),
    ],
  });
}

function call(db: ReturnType<typeof seed>, slug: string | undefined) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    // 正式的 middleware 用 env 建 service client；測試換成替身
    (c as unknown as { set: (k: string, v: unknown) => void }).set('supabase', db.client);
    await next();
  });
  app.use('*', publicOrgMiddleware);
  app.route('/', publicCatalogRoute as unknown as Hono);
  return app.request('/', {}, { PUBLIC_ORG_SLUG: slug });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T04:00:00Z`));
});
afterEach(() => vi.useRealTimers());

describe('GET /api/public/catalog', () => {
  it('沒設 PUBLIC_ORG_SLUG：404 PUBLIC_DISABLED', async () => {
    const res = await call(seed(), undefined);

    expect(res.status).toBe(404);
    expect(((await res.json()) as any).code).toBe('PUBLIC_DISABLED');
  });

  it('slug 對不到任何 org：同樣 404 PUBLIC_DISABLED', async () => {
    const res = await call(seed(), 'nope');

    expect(res.status).toBe(404);
    expect(((await res.json()) as any).code).toBe('PUBLIC_DISABLED');
  });

  it('只回部署那個 org、啟用中、未結束、課程啟用中的班', async () => {
    const res = await call(seed(), 'demo');
    const ids = ((await res.json()) as any).data.map((c: { classId: string }) => c.classId);

    expect(res.status).toBe(200);
    expect(ids.sort()).toEqual([id(11), id(12)]);
  });

  it('名額＝上限 − active／pending_payment（不算 withdrawn、不算別 org）；費用停用回 null', async () => {
    const res = await call(seed(), 'demo');
    const byId = new Map(
      ((await res.json()) as any).data.map((c: { classId: string }) => [c.classId, c]),
    );

    expect(byId.get(id(11))).toMatchObject({
      remainingSeats: 1,
      fee: { amount: 4500, billingMode: 'monthly' },
      slots: [{ weekday: 2, startTime: '18:00', endTime: '20:00' }],
    });
    expect((byId.get(id(12)) as any).fee).toBeNull();
  });

  it('不回老師名（公開頁是任何人）', async () => {
    const res = await call(seed(), 'demo');
    const body = JSON.stringify(await res.json());

    expect(body).not.toContain('王老師');
    expect(body).not.toContain('teacherNames');
  });

  it('可快取一分鐘', async () => {
    const res = await call(seed(), 'demo');

    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
  });
});
