import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import staffRoute from './staff';

/**
 * #966 A2'：**權限只能給自己有的**（使用者 2026-10-01 裁定）。接線測試 —— 純函式在
 * `lib/role-assignment.spec.ts`，這裡證明 POST／PUT 真的呼叫到它。
 *
 * 呼叫者刻意設成**不受分校限制**（`campusScope: null`）：這條規則跟分校無關，
 * 不受限的管理員一樣受它約束。
 */
const ORG = '00000000-0000-0000-0000-0000000000aa';
const CAMPUS = '00000000-0000-0000-0000-0000000000c1';
const STAFF_ID = '00000000-0000-0000-0000-0000000000d2';

function fakeDb(rows: Record<string, unknown[]>) {
  const make = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder as never;
    const data = rows[table] ?? [];
    Object.assign(builder, {
      select: () => chain(),
      insert: () => chain(),
      update: () => chain(),
      delete: () => chain(),
      eq: () => chain(),
      in: () => chain(),
      order: () => chain(),
      limit: () => chain(),
      maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data, count: 0, error: null }),
    });
    return builder;
  };
  return { from: (table: string) => make(table) };
}

function appWith(callerPermissions: string[], db: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db);
    set('orgId', ORG);
    set('userId', 'requester-user');
    set('roles', ['admin']);
    set('permissions', callerPermissions);
    set('campusScope', null);
    await next();
  });
  app.route('/', staffRoute as unknown as Hono);
  return app;
}

const CALLER = ['manage_staff', 'manage_roles', 'basic_operations'];

function postAdmin(callerPermissions: string[], permissions: string[]) {
  const db = fakeDb({ user_roles: [{ role: 'admin' }], campuses: [{ id: CAMPUS }] });
  return appWith(callerPermissions, db).request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      displayName: '新主任',
      email: 'new-admin@example.test',
      campusIds: [CAMPUS],
      roles: ['admin'],
      permissions,
    }),
  });
}

function putPermissions(callerPermissions: string[], prior: string[], next: string[]) {
  const db = fakeDb({
    staff: [{ id: STAFF_ID, user_id: 'other-user', org_id: ORG }],
    user_roles: [{ role: 'admin', permissions: prior }],
  });
  return appWith(callerPermissions, db).request(`/${STAFF_ID}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ permissions: next }),
  });
}

describe('POST /api/staff —— 只能發出自己有的權限', () => {
  it('自己沒有 manage_finance，建不出有它的管理員', async () => {
    const res = await postAdmin(CALLER, ['basic_operations', 'manage_finance']);
    expect(res.status).toBe(403);
  });

  it('只發自己有的，不被這一層擋', async () => {
    const res = await postAdmin(CALLER, ['basic_operations']);
    expect(res.status).not.toBe(403);
  });

  it('`*` 可以發任何權限', async () => {
    const res = await postAdmin(['*'], ['manage_finance', 'view_reports']);
    expect(res.status).not.toBe(403);
  });
});

describe('PUT /api/staff/:id —— 只能加上自己有的權限', () => {
  it('替別人加上自己沒有的 manage_finance → 403', async () => {
    const res = await putPermissions(
      CALLER,
      ['basic_operations'],
      ['basic_operations', 'manage_finance'],
    );
    expect(res.status).toBe(403);
  });

  it('對方原本就有 manage_finance，這次只多加自己有的 → 不被擋', async () => {
    const res = await putPermissions(
      CALLER,
      ['manage_finance'],
      ['manage_finance', 'basic_operations'],
    );
    expect(res.status).not.toBe(403);
  });

  it('拿掉對方的權限（就算自己沒有那個權限）→ 不被擋：降權不是提權', async () => {
    const res = await putPermissions(
      CALLER,
      ['manage_finance', 'basic_operations'],
      ['basic_operations'],
    );
    expect(res.status).not.toBe(403);
  });
});
