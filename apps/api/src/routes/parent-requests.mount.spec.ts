import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';

/**
 * #1728 計畫席裁定：`/api/parent-requests` 的**掛載授權**要有測試。走整個 app（只換掉 authMiddleware），
 * 所以驗的是 `index.ts` 的 `mount(…, ADMIN_ONLY, { all: 'manage_students' })` 本身 ——
 * 路由內的分校範圍在 parent-requests.spec.ts。
 * 讀也擋：學生名字、家長電話是個資（同 /api/public-applications）。
 */

const ORG = 'org-a';
const REQ = '00000000-0000-0000-0000-0000000000e1';

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

type TestApp = {
  request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response>;
  routes: ReadonlyArray<{ method: string; path: string }>;
};
let app: TestApp;
// #1580：整個 app 的動態 import（transform 幾秒）放在 hook、逾時另計 ——
// 放在第一條測試裡會算進那條的 5 秒，機器忙時前幾條逾時、吃到模組快取的後面幾條又過
beforeAll(async () => {
  app = (await import('../index')).default as unknown as TestApp;
}, 30_000);

async function call(method: 'GET' | 'PATCH') {
  return method === 'GET'
    ? app.request('/api/parent-requests', {}, env)
    : app.request(
        `/api/parent-requests/trial/${REQ}`,
        {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'scheduled', scheduledDate: '2026-11-04' }),
        },
        env,
      );
}

describe('/api/parent-requests 的掛載授權：管理員＋manage_students（讀也擋）', () => {
  beforeEach(() => {
    ctx.db = createMultiOrgDb({
      enrollment_requests: [],
      trial_requests: [
        {
          id: REQ,
          org_id: ORG,
          student_id: 's1',
          course_id: 'k1',
          status: 'pending',
          requested_by: 'u-parent',
          created_at: '2026-10-16T00:00:00Z',
          students: { name: '小明' },
          courses: { name: '國小英文', campus_id: 'c1', campuses: { name: '本校' } },
        },
      ],
      parents: [],
      ba_user: [],
      audit_logs: [],
    });
  });

  it.each([
    ['管理員沒有 manage_students', ['admin'], ['manage_finance']],
    ['老師', ['teacher'], []],
    ['老師帶了 manage_students（不是管理員就不行）', ['teacher'], ['manage_students']],
    ['家長', ['parent'], []],
  ])('%s：GET、PATCH 都 403，沒寫入', async (_label, roles, permissions) => {
    ctx.roles = roles;
    ctx.permissions = permissions;
    expect((await call('GET')).status).toBe(403);
    expect((await call('PATCH')).status).toBe(403);
    expect(ctx.db!.rows('trial_requests')[0]!['status']).toBe('pending');
  });

  it('管理員有 manage_students：GET、PATCH 都 200', async () => {
    ctx.roles = ['admin'];
    ctx.permissions = ['manage_students'];
    expect((await call('GET')).status).toBe(200);
    expect((await call('PATCH')).status).toBe(200);
    expect(ctx.db!.rows('trial_requests')[0]!['status']).toBe('scheduled');
  });
});
