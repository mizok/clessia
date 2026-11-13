// scope-contract: GET /api/campuses/:id
// scope-contract: POST /api/campuses
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493 R2／?2：分校單筆讀看範圍；受限管理員不能新增分校**（保留類：授權範圍），
 * 對真的本機 PostgREST＋Postgres 跑。
 *
 * `GET /api/campuses/:id` 原本只看 org：受限管理員用 id 讀得到別校的地址、電話與收款帳戶（paymentInfo）。
 * `POST /api/campuses` 原本受限者也建得出分校（建了自己也不在那個分校）。
 * 裁定（11-13）：範圍外＝404；受限者 POST 一律 403 REQUIRES_ALL_CAMPUSES（同 grade-promotions）。
 *
 * fixture：C1、C2（C2 帶收款帳戶）。管理員只被指派 C1。
 */

const URL = process.env['SUPABASE_URL'];
const KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const DB = process.env['DATABASE_URL'];
if ((!URL || !KEY || !DB) && process.env['CONTRACT_REQUIRED']) {
  throw new Error(
    '[contract] CONTRACT_REQUIRED 但沒有 SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY／DATABASE_URL',
  );
}
const run = URL && KEY && DB ? describe : describe.skip;

const pool = DB ? new Pool({ connectionString: DB }) : null;
afterAll(() => pool?.end());

const ctx = { orgId: '', userId: '', campusScope: null as string[] | null };

vi.mock('../middleware/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../middleware/auth')>();
  const { createMiddleware } = await import('hono/factory');
  return {
    ...original,
    authMiddleware: createMiddleware(async (c, next) => {
      const supabase = createServiceClientFromEnv({
        SUPABASE_URL: URL!,
        SUPABASE_SECRET_KEY: KEY!,
      } as never);
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', supabase);
      set('orgId', ctx.orgId);
      set('userId', ctx.userId);
      set('roles', ['admin']);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', 'admin');
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', ctx.campusScope);
      set('auth', {
        pool: {
          query: pool!.query.bind(pool),
          connect: pool!.connect.bind(pool),
          end: async () => {},
        },
      });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

run('#2493 分校單筆讀與新增看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '', c2: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：分校範圍')", []);
    fx.c1 = await one("insert into campuses (org_id, name) values ($1, 'C1')", [ctx.orgId]);
    fx.c2 = await one(
      "insert into campuses (org_id, name, address) values ($1, 'C2', '別校的地址 99 號')",
      [ctx.orgId],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from campuses where org_id = $1',
      'delete from audit_logs where org_id = $1',
      'delete from organizations where id = $1',
    ]) {
      await q(sql, [ctx.orgId]);
    }
  }, 120_000);

  type Scope = 'all' | 'c1' | 'none';
  const call = async (scope: Scope, method: string, path: string, body?: unknown) => {
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx.c1] : [];
    try {
      return await app.request(
        `/api/campuses${path}`,
        {
          method,
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        env,
      );
    } finally {
      ctx.campusScope = null;
    }
  };
  const campusCount = async () =>
    Number(
      (await q<{ n: string }>('select count(*) n from campuses where org_id = $1', [ctx.orgId]))[0]!
        .n,
    );

  it('GET /:id：受限 C1 讀 C2 → 404 且不吐地址；空範圍連 C1 也 404；C1、不受限照常', async () => {
    const out = await call('c1', 'GET', `/${fx.c2}`);
    expect(out.status).toBe(404);
    expect(JSON.stringify(await out.json())).not.toContain('別校的地址');
    expect((await call('none', 'GET', `/${fx.c1}`)).status).toBe(404);
    expect((await call('c1', 'GET', `/${fx.c1}`)).status).toBe(200);
    expect((await call('all', 'GET', `/${fx.c2}`)).status).toBe(200);
  });

  it('POST /：受限 C1、空範圍 → 403 REQUIRES_ALL_CAMPUSES、沒建；不受限照常 201', async () => {
    const before = await campusCount();
    const restricted = await call('c1', 'POST', '', { name: 'C3' });
    expect(restricted.status).toBe(403);
    expect(await restricted.json()).toMatchObject({ code: 'REQUIRES_ALL_CAMPUSES' });
    expect((await call('none', 'POST', '', { name: 'C4' })).status).toBe(403);
    expect(await campusCount()).toBe(before);
    expect((await call('all', 'POST', '', { name: 'C5' })).status).toBe(201);
    expect(await campusCount()).toBe(before + 1);
  });
});
