import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../index';
import { getCachedIdentity } from '../lib/identity-cache';
import { authMiddleware } from '../middleware/auth';
import meRoute from './me';

/**
 * #1631：改自己身分的寫入之後**立刻**讀 /api/me，要拿到新值。
 *
 * 寫入那個請求本身經過 authMiddleware 時，會把**寫入前**的身分存進 30 秒快取（#1595 P1b）；
 * 不清的話，前端接著打的 /api/me 在同一個 isolate 拿到舊角色 —— 啟用家長身份後畫面毫無變化。
 * 這裡用真的 middleware ＋ 真的 me 路由，替身只換掉 DB。
 */

const getSession = vi.fn();
vi.mock('../lib/get-auth', () => ({
  getAuth: () => ({ api: { getSession: (...a: unknown[]) => getSession(...a) }, pool: undefined }),
}));

/** 可變的假 DB：每張表一個陣列；寫入失敗用 `failWrites` 模擬 */
function fakeDb() {
  const tables: Record<string, Record<string, unknown>[]> = {
    user_roles: [{ user_id: 'u1', role: 'admin', permissions: [] }],
    staff: [
      { user_id: 'u1', org_id: 'o1', status: 'active', display_name: '舊名', birthday: null },
    ],
    parents: [],
    profiles: [],
    ba_user: [{ id: 'u1', name: 'n', email: 'a@example.com', phone: null }],
  };
  const failWrites = new Set<string>();

  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    const rows = () =>
      (tables[table] ?? [])
        .filter((r) => filters.every(([k, v]) => r[k] === v))
        .map((r) => ({
          ...r,
          // 巢狀 select 的關聯：測試裡一律空
          staff_campuses: [],
          parent_student_relations: [],
        }));
    const result = () => Promise.resolve({ data: rows(), error: null });
    const writeResult = (apply: () => void) => {
      if (failWrites.has(table)) return eqable(Promise.resolve({ error: { message: 'boom' } }));
      apply();
      return eqable(Promise.resolve({ error: null }));
    };
    // update(...).eq(...).eq(...)：在最後被 await 時才套用
    const eqable = <T extends object>(p: T): T & { eq: (k: string, v: unknown) => unknown } =>
      Object.assign(p, { eq: () => eqable(p) });

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, ng: (e: unknown) => unknown) => result().then(ok, ng),
      insert: (row: Record<string, unknown>) => writeResult(() => tables[table]!.push(row)),
      upsert: (row: Record<string, unknown>) => writeResult(() => tables[table]!.push(row)),
      update: (patch: Record<string, unknown>) =>
        writeResult(() => tables[table]!.forEach((r) => Object.assign(r, patch))),
    };
    return builder;
  };
  return { tables, failWrites, client: { from } };
}

let db = fakeDb();
vi.mock('../lib/supabase', () => ({
  createServiceClientFromEnv: () => db.client,
}));

function app() {
  getSession.mockResolvedValue({ user: { id: 'u1', orgId: 'o1' } });
  const a = new Hono<AppEnv>();
  a.use('*', authMiddleware);
  a.route('/api/me', meRoute);
  return a;
}

const me = async (a: Hono<AppEnv>) =>
  (await (await a.request('/api/me')).json()) as { roles: string[]; displayName: string };

describe('/api/me 自己的寫入之後立刻讀回新值（#1631）', () => {
  afterEach(() => {
    db = fakeDb();
    getSession.mockReset();
  });

  it('啟用家長身份 → 立刻 GET /api/me 就有 parent', async () => {
    const a = app();
    expect((await me(a)).roles).toEqual(['admin']); // 快取住舊身分

    const res = await a.request('/api/me/activate-parent', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { roles: string[] }).roles).toEqual(['admin', 'parent']);

    expect((await me(a)).roles).toEqual(['admin', 'parent']);
  });

  it('啟用失敗 → 不清快取，也不會因此多出 parent', async () => {
    const a = app();
    await me(a);
    db.failWrites.add('user_roles');

    const res = await a.request('/api/me/activate-parent', { method: 'POST' });
    expect(res.status).toBe(500);

    expect(getCachedIdentity('u1')).toBeDefined(); // 失敗不清
    expect((await me(a)).roles).toEqual(['admin']);
  });

  it('改名字 → 立刻 GET /api/me 就是新名字', async () => {
    const a = app();
    expect((await me(a)).displayName).toBe('舊名');

    const res = await a.request('/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: '新名' }),
    });
    expect(res.status).toBe(200);

    expect((await me(a)).displayName).toBe('新名');
  });
});
