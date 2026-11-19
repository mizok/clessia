// scope-contract: GET /api/campuses/:id
// scope-contract: POST /api/campuses
// scope-contract: GET /api/campuses
// scope-contract: PUT /api/campuses/:id
// scope-contract: DELETE /api/campuses/:id
// scope-contract: GET /api/campuses/:id/classrooms
// scope-contract: POST /api/campuses/:id/classrooms
// scope-contract: PUT /api/campuses/:id/classrooms/:roomId
// scope-contract: DELETE /api/campuses/:id/classrooms/:roomId
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
 *
 * 下半是舊端點的契約認領（#2493 上半，盤點時範圍已 OK）：列表只剩範圍內；改、刪分校與教室四支
 * 範圍外 403 且沒動到；不受限照常。
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
  const fx = { c1: '', c2: '', room2: '' };

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
    fx.room2 = await one(
      "insert into classrooms (org_id, campus_id, name) values ($1, $2, '別校教室')",
      [ctx.orgId, fx.c2],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from classrooms where org_id = $1',
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

  // ── 舊端點認領（#2493 上半） ──
  const campusName = async (id: string) =>
    (await q<{ name: string }>('select name from campuses where id = $1', [id]))[0]?.name;
  const roomName = async () =>
    (await q<{ name: string }>('select name from classrooms where id = $1', [fx.room2]))[0]?.name;

  it('GET /：受限 C1 只列 C1、空範圍 0 列；不受限兩校都在', async () => {
    const ids = async (scope: Scope) =>
      ((await (await call(scope, 'GET', '?pageSize=0')).json()) as { data: { id: string }[] }).data
        .map((r) => r.id)
        .filter((id) => id === fx.c1 || id === fx.c2)
        .sort();
    expect(await ids('c1')).toEqual([fx.c1]);
    expect(await ids('none')).toEqual([]);
    expect(await ids('all')).toEqual([fx.c1, fx.c2].sort());
  });

  it('PUT /:id、DELETE /:id：受限 C1 對 C2 → 403、沒改沒刪；不受限改得動', async () => {
    expect((await call('c1', 'PUT', `/${fx.c2}`, { name: '被改了' })).status).toBe(403);
    expect((await call('c1', 'DELETE', `/${fx.c2}`)).status).toBe(403);
    expect(await campusName(fx.c2)).toBe('C2');
    expect((await call('c1', 'PUT', `/${fx.c1}`, { name: 'C1' })).status).toBe(200);
    expect((await call('all', 'PUT', `/${fx.c2}`, { name: 'C2' })).status).toBe(200);
  });

  it('教室四支：受限 C1 對 C2 → 403、沒動到；不受限照常', async () => {
    expect((await call('c1', 'GET', `/${fx.c2}/classrooms`)).status).toBe(403);
    expect((await call('c1', 'POST', `/${fx.c2}/classrooms`, { name: '偷建' })).status).toBe(403);
    expect(
      (await call('c1', 'PUT', `/${fx.c2}/classrooms/${fx.room2}`, { name: '被改了' })).status,
    ).toBe(403);
    expect((await call('c1', 'DELETE', `/${fx.c2}/classrooms/${fx.room2}`)).status).toBe(403);
    expect(await roomName()).toBe('別校教室');
    const [n] = await q<{ n: number }>(
      'select count(*)::int n from classrooms where campus_id = $1',
      [fx.c2],
    );
    expect(n!.n).toBe(1);

    const list = await call('all', 'GET', `/${fx.c2}/classrooms`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json())).toContain('別校教室');
    expect((await call('c1', 'GET', `/${fx.c1}/classrooms`)).status).toBe(200);
    const created = await call('all', 'POST', `/${fx.c2}/classrooms`, { name: '新教室' });
    expect(created.status).toBe(201);
    const { data: room } = (await created.json()) as { data: { id: string } };
    expect(
      (await call('all', 'PUT', `/${fx.c2}/classrooms/${room.id}`, { name: '新教室 2' })).status,
    ).toBe(200);
    expect((await call('all', 'DELETE', `/${fx.c2}/classrooms/${room.id}`)).status).toBe(200);
  });

  it('DELETE /:id：不受限刪得掉（放最後：C5 是上面 POST 建的）', async () => {
    const [c5] = await q<{ id: string }>(
      "select id from campuses where org_id = $1 and name = 'C5'",
      [ctx.orgId],
    );
    expect((await call('c1', 'DELETE', `/${c5!.id}`)).status).toBe(403);
    expect((await call('all', 'DELETE', `/${c5!.id}`)).status).toBe(200);
    expect(await campusName(c5!.id)).toBeUndefined();
  });
});
