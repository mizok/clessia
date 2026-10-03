import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

/**
 * #1127：分校門口的掃碼機台帳號。由人員頁（`manage_staff`）建立：只能單獨當 kiosk、
 * 剛好綁一個分校、不帶權限與科目、email 由系統給佔位值；建完直接回一次性登入連結。
 *
 * kiosk 什麼都讀不到也發不出任何權限，所以**不要求 `manage_roles`** ——
 * 建它不是提權（`index.ts` 的掛載與 `daily-checkins.ts` 只開打卡）。
 */
const createUser = vi.fn(async (_: { body: { email: string } }) => ({
  user: { id: 'kiosk-user' },
}));
vi.mock('../lib/get-auth', () => ({ getAuth: () => ({ api: { createUser } }) }));
vi.mock('./login-links/mint', () => ({
  mintLoginLinkForRequest: vi.fn(async () => 'https://login.example/link'),
}));

const { default: staffRoute } = await import('./staff');

const ORG = '00000000-0000-0000-0000-0000000000aa';
const CAMPUS = '00000000-0000-0000-0000-0000000000c1';
const OTHER = '00000000-0000-0000-0000-0000000000c2';
const SUBJECT = '00000000-0000-0000-0000-0000000000e1';

function fakeDb() {
  const inserted: Array<{ table: string; rows: unknown }> = [];
  const make = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder as never;
    Object.assign(builder, {
      select: () => chain(),
      insert: (rows: unknown) => {
        inserted.push({ table, rows });
        return table === 'audit_logs' ? Promise.resolve({ error: null }) : chain();
      },
      update: () => chain(),
      delete: () => chain(),
      eq: () => chain(),
      in: () => chain(),
      maybeSingle: () =>
        Promise.resolve({
          // checkUserIsAdmin 問 user_roles；ba_user 查無同 email；findInOrg 讀回 staff
          data:
            table === 'user_roles'
              ? { role: 'admin' }
              : table === 'staff'
                ? { id: 'staff-k', user_id: 'kiosk-user', org_id: ORG, status: 'active' }
                : null,
          error: null,
        }),
      single: () =>
        Promise.resolve({ data: table === 'staff' ? { id: 'staff-k' } : null, error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        resolve({
          data:
            table === 'campuses'
              ? [{ id: CAMPUS }]
              : table === 'subjects'
                ? [{ id: SUBJECT }]
                : table === 'user_roles'
                  ? [{ user_id: 'kiosk-user', role: 'kiosk', permissions: [] }]
                  : [],
          error: null,
        }),
    });
    return builder;
  };
  return { inserted, from: (table: string) => make(table) };
}

async function post(body: Record<string, unknown>, permissions = ['manage_staff']) {
  const db = fakeDb();
  const app = new Hono<{ Bindings: { PLACEHOLDER_EMAIL_DOMAIN: string } }>();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db);
    set('orgId', ORG);
    set('userId', 'requester-user');
    set('roles', ['admin']);
    set('permissions', permissions);
    set('campusScope', null);
    await next();
  });
  app.route('/', staffRoute as unknown as Hono);
  createUser.mockClear();
  const res = await app.request(
    '/',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: '本校門口', campusIds: [CAMPUS], ...body }),
    },
    { PLACEHOLDER_EMAIL_DOMAIN: 'phone.internal' },
  );
  return { res, db };
}

describe('POST /api/staff —— 建掃碼機台帳號（#1127）', () => {
  it('只有 manage_staff 就建得出來：佔位 email、kiosk 角色無權限、綁一個分校、回登入連結', async () => {
    const { res, db } = await post({ roles: ['kiosk'] });

    expect(res.status).toBe(201);
    expect(createUser.mock.calls[0]?.[0].body.email).toMatch(
      /^kiosk-[0-9a-f-]{36}@phone\.internal$/,
    );
    expect(db.inserted.find((i) => i.table === 'user_roles')?.rows).toEqual([
      { user_id: 'kiosk-user', role: 'kiosk', permissions: [] },
    ]);
    expect(db.inserted.find((i) => i.table === 'staff_campuses')?.rows).toEqual([
      { staff_id: 'staff-k', campus_id: CAMPUS },
    ]);
    const json = (await res.json()) as { loginUrl: string; data: { roles: string[] } };
    expect(json.loginUrl).toBe('https://login.example/link');
    expect(json.data.roles).toEqual(['kiosk']);
  });

  it.each([
    ['跟別的角色一起', { roles: ['kiosk', 'admin'] }],
    ['綁兩個分校', { roles: ['kiosk'], campusIds: [CAMPUS, OTHER] }],
    ['帶權限', { roles: ['kiosk'], permissions: ['basic_operations'] }],
    ['帶科目', { roles: ['kiosk'], subjectIds: [SUBJECT] }],
    ['自己給 email', { roles: ['kiosk'], email: 'kiosk@example.test' }],
  ])('%s → 400，什麼都沒建', async (_, body) => {
    const { res, db } = await post(body, ['*']);

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_KIOSK');
    expect(createUser).not.toHaveBeenCalled();
    expect(db.inserted).toHaveLength(0);
  });

  it('一般人員沒給 email → 400（佔位 email 只給機台）', async () => {
    const { res } = await post({ roles: ['admin'] }, ['*']);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('EMAIL_REQUIRED');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('一般人員照舊要 manage_roles', async () => {
    const { res } = await post({ roles: ['admin'], email: 'a@example.test' });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/staff/:id —— 機台建立時的限制改了也要成立（#1127）', () => {
  async function put(body: Record<string, unknown>, targetIsKiosk = true) {
    const db = fakeDb();
    const from = db.from;
    // checkUserIsAdmin 問 role=admin、守衛問 role=kiosk —— 替身不看 eq，所以依次回
    db.from = (table: string) => {
      const builder = from(table) as Record<string, unknown>;
      if (table === 'user_roles') {
        let role = '';
        builder['eq'] = (column: string, value: string) => {
          if (column === 'role') role = value;
          return builder;
        };
        builder['maybeSingle'] = () =>
          Promise.resolve({
            data: role === 'admin' || (role === 'kiosk' && targetIsKiosk) ? { role } : null,
            error: null,
          });
      }
      return builder as never;
    };
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', db);
      set('orgId', ORG);
      set('userId', 'requester-user');
      set('roles', ['admin']);
      set('permissions', ['*']);
      set('campusScope', null);
      await next();
    });
    app.route('/', staffRoute as unknown as Hono);
    return app.request('/00000000-0000-0000-0000-0000000000d9', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it.each([
    ['改角色', { roles: ['admin'] }],
    ['加權限', { permissions: ['basic_operations'] }],
    ['加科目', { subjectIds: [SUBJECT] }],
    ['綁兩個分校', { campusIds: [CAMPUS, OTHER] }],
  ])('%s → 400', async (_, body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_KIOSK');
  });

  it('改名稱、換成另一個分校 —— 不被這一層擋', async () => {
    const res = await put({ displayName: '後門', campusIds: [CAMPUS] });
    expect(res.status, await res.text()).not.toBe(400);
  });

  it('一般人員改角色不受這一層影響', async () => {
    expect((await put({ roles: ['admin'] }, false)).status).not.toBe(400);
  });
});
