import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';

/**
 * #1732 計畫席要求（#1728 的教訓）：`/api/leave-streaks` 的**掛載授權**要有測試。走整個 app（只換掉
 * authMiddleware），驗的是 `index.ts` 的 `mount(…, ADMIN_ONLY, { all: 'manage_finance' })` 本身 ——
 * leave-streaks.spec.ts 自己掛 app，拿掉 mount 那行的權限它照樣綠。
 * 讀也擋：明細有餐費單價、計費方式。偵測本身由 lib/leave-streak.spec 守，這裡換成「沒有段」。
 */

vi.mock('../lib/leave-streak', async (importActual) => ({
  ...(await importActual<typeof import('../lib/leave-streak')>()),
  loadLeaveStreaks: vi.fn(async () => ({ byStudent: new Map(), threshold: 3 })),
}));

const ORG = 'org-a';
const STU = '00000000-0000-4000-8000-0000000000a1';
const REVIEW = '00000000-0000-4000-8000-0000000000b1';

const ctx: {
  db: ReturnType<typeof createMultiOrgDb> | null;
  roles: string[];
  permissions: string[];
} = { db: null, roles: ['admin'], permissions: [] };

vi.mock('../middleware/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../middleware/auth')>();
  const { createMiddleware } = await import('hono/factory');
  return {
    ...original,
    authMiddleware: createMiddleware(async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', ctx.db!.client);
      set('orgId', ORG);
      set('userId', 'u-1');
      set('roles', ctx.roles);
      set('permissions', ctx.permissions);
      set('activeRole', ctx.roles[0]);
      set('studentScope', null);
      set('campusScope', null);
      await next();
    }),
  };
});

const env = { ENVIRONMENT: 'test', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };

async function call(kind: 'list' | 'detail' | 'mark' | 'undo') {
  const app = (await import('../index')).default as unknown as {
    request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response>;
  };
  const json = (body: object) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  switch (kind) {
    case 'list':
      return app.request(`/api/leave-streaks?studentIds=${STU}`, {}, env);
    case 'detail':
      return app.request(`/api/leave-streaks/students/${STU}`, {}, env);
    case 'mark':
      return app.request(
        `/api/leave-streaks/students/${STU}/reviews`,
        json({ firstDay: '2026-10-01', lastDay: '2026-10-03' }),
        env,
      );
    case 'undo':
      return app.request(
        `/api/leave-streaks/students/${STU}/reviews/${REVIEW}`,
        { method: 'DELETE' },
        env,
      );
  }
}

const KINDS = ['list', 'detail', 'mark', 'undo'] as const;

describe('/api/leave-streaks 的掛載授權：管理員＋manage_finance（讀也擋）', () => {
  beforeEach(() => {
    ctx.db = createMultiOrgDb({
      students: [{ id: STU, org_id: ORG, name: '小明', enrollments: [] }],
      leave_streak_reviews: [
        {
          id: REVIEW,
          org_id: ORG,
          student_id: STU,
          first_day: '2026-10-01',
          last_day: '2026-10-03',
        },
      ],
      meal_records: [],
      enrollments: [],
      audit_logs: [],
    });
  });

  it.each([
    ['管理員沒有 manage_finance', ['admin'], ['manage_students', 'manage_org_settings']],
    ['老師', ['teacher'], []],
    ['老師帶了 manage_finance（不是管理員就不行）', ['teacher'], ['manage_finance']],
    ['家長', ['parent'], []],
  ])('%s：四支都 403，沒寫入也沒刪', async (_label, roles, permissions) => {
    ctx.roles = roles;
    ctx.permissions = permissions;
    for (const kind of KINDS) expect((await call(kind)).status, kind).toBe(403);
    expect(ctx.db!.rows('leave_streak_reviews')).toHaveLength(1);
  });

  it('管理員有 manage_finance：四支都放行（不是 403）', async () => {
    ctx.roles = ['admin'];
    ctx.permissions = ['manage_finance'];
    expect((await call('list')).status).toBe(200);
    expect((await call('detail')).status).toBe(200);
    // 沒有段 → 伺服器重算對不上 → 409（過了掛載那一關）
    expect((await call('mark')).status).toBe(409);
    expect((await call('undo')).status).toBe(204);
    expect(ctx.db!.rows('leave_streak_reviews')).toHaveLength(0);
  });
});
