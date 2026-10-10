import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';

/**
 * #1314 D2：聯絡紀錄。走**整個 app**（只換掉 authMiddleware），所以 mount 的權限
 *（`write: ['basic_operations', 'manage_students']` 任一）與路由內的學生授權一起驗。
 */

const ORG = 'org-a';
const S1 = '00000000-0000-0000-0000-0000000000a1';
const S_OTHER = '00000000-0000-0000-0000-0000000000b1';
const P1 = '00000000-0000-0000-0000-0000000000c1';
const P_OTHER = '00000000-0000-0000-0000-0000000000c2';

const ctx: {
  db: ReturnType<typeof createMultiOrgDb> | null;
  roles: string[];
  permissions: string[];
  campusScope: string[] | null;
  userId: string;
} = { db: null, roles: ['admin'], permissions: [], campusScope: null, userId: 'u-admin' };

vi.mock('../middleware/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../middleware/auth')>();
  const { createMiddleware } = await import('hono/factory');
  return {
    ...original,
    authMiddleware: createMiddleware(async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', ctx.db!.client);
      set('orgId', ORG);
      set('userId', ctx.userId);
      set('roles', ctx.roles);
      set('permissions', ctx.permissions);
      set('activeRole', ctx.roles[0]);
      set('studentScope', null);
      set('campusScope', ctx.campusScope);
      await next();
    }),
  };
});

function seed() {
  return createMultiOrgDb({
    students: [
      { id: S1, org_id: ORG, name: '小明', enrollments: [{ classes: { campus_id: 'campus-1' } }] },
      { id: S_OTHER, org_id: 'org-b', name: '別人', enrollments: [] },
    ],
    parent_student_relations: [
      { student_id: S1, parent_id: P1, parents: { org_id: ORG, name: '王媽媽' } },
      // P_OTHER 是本 org 的家長，但不是 S1 的
      { student_id: S_OTHER, parent_id: P_OTHER, parents: { org_id: ORG, name: '李爸爸' } },
    ],
    contact_logs: [],
    staff: [{ id: 'staff-t', user_id: 'u-teacher', org_id: ORG }],
    schedules: [],
    enrollments: [],
  });
}

const env = { ENVIRONMENT: 'test', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };

async function call(method: 'GET' | 'POST', body?: Record<string, unknown>, query = '') {
  const app = (await import('../index')).default as unknown as {
    request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response>;
  };
  const res = await app.request(
    `/api/contact-logs${query}`,
    method === 'POST'
      ? { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {},
    env,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const post = (body: Record<string, unknown>) =>
  call('POST', { studentId: S1, channel: 'phone', ...body });

describe('POST /api/contact-logs —— mount 權限：basic_operations 或 manage_students 任一', () => {
  beforeEach(() => {
    ctx.db = seed();
    ctx.roles = ['admin'];
    ctx.campusScope = null;
    ctx.userId = 'u-admin';
  });

  it.each([['basic_operations'], ['manage_students'], ['*']])('管理員有 %s → 201', async (p) => {
    ctx.permissions = [p];
    expect((await post({})).status).toBe(201);
  });

  it('管理員兩個都沒有（只有 manage_finance）→ 403，沒寫入', async () => {
    ctx.permissions = ['manage_finance'];
    expect((await post({})).status).toBe(403);
    expect(ctx.db!.rows('contact_logs')).toEqual([]);
  });

  it('讀不需要權限（GET 交給角色層）', async () => {
    ctx.permissions = [];
    expect((await call('GET', undefined, `?studentId=${S1}`)).status).toBe(200);
  });
});

describe('/api/contact-logs —— 學生授權與驗證', () => {
  beforeEach(() => {
    ctx.db = seed();
    ctx.roles = ['admin'];
    ctx.permissions = ['*'];
    ctx.campusScope = null;
    ctx.userId = 'u-admin';
  });

  it('寫入帶 org、學生、家長、記錄人；GET 新到舊', async () => {
    const created = await post({ parentId: P1, note: '問今天怎麼沒來' });
    expect(created.status).toBe(201);
    expect(ctx.db!.rows('contact_logs')[0]).toMatchObject({
      org_id: ORG,
      student_id: S1,
      parent_id: P1,
      channel: 'phone',
      note: '問今天怎麼沒來',
      created_by: 'u-admin',
    });
    await post({ channel: 'line' });

    const list = await call('GET', undefined, `?studentId=${S1}`);
    expect((list.body['data'] as unknown[]).length).toBe(2);
  });

  it('別 org 的學生 → 404；受限管理員範圍外 → 404', async () => {
    expect((await post({ studentId: S_OTHER })).status).toBe(404);
    ctx.campusScope = ['campus-x'];
    expect((await post({})).status).toBe(404);
    expect(ctx.db!.rows('contact_logs')).toEqual([]);
  });

  it('老師：非任課學生 → 403', async () => {
    ctx.roles = ['teacher'];
    ctx.permissions = [];
    ctx.userId = 'u-teacher';
    expect((await post({})).status).toBe(403);
    expect((await call('GET', undefined, `?studentId=${S1}`)).status).toBe(403);
  });

  it('parentId 不是這個學生的家長 → 404 PARENT_NOT_FOUND，沒寫入', async () => {
    const res = await post({ parentId: P_OTHER });
    expect(res.status).toBe(404);
    expect(res.body['code']).toBe('PARENT_NOT_FOUND');
    expect(ctx.db!.rows('contact_logs')).toEqual([]);
  });

  it('channel 不合法、note 超過 500 字 → 400', async () => {
    expect((await post({ channel: 'fax' })).status).toBe(400);
    expect((await post({ note: 'x'.repeat(501) })).status).toBe(400);
  });
});
