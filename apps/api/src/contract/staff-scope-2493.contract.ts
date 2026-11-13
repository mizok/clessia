// scope-contract: GET /api/staff/:id
// scope-contract: PUT /api/staff/:id
// scope-contract: PATCH /api/staff/:id/archive
// scope-contract: PATCH /api/staff/:id/deactivate
// scope-contract: PATCH /api/staff/:id/activate
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAuth } from '../auth';
import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493 W3／R3：人員的單筆讀、改、封存、停用、啟用看分校範圍**（保留類：授權範圍），
 * 對真的本機 PostgREST＋Postgres 跑。
 *
 * 原本只看 org：受限管理員用 id 讀得到別校人員的聯絡方式與權限、改得了他的資料與權限、
 * 把他的分校改成自己的（搶人）、封存停用他。
 * 裁定（11-13）：讀＝人員任一分校在範圍；寫＝人員**全部**分校都在範圍（跨校人員只有不受限者能改）；
 * 沒有任何分校的人員對受限者是範圍外；範圍外＝404 不寫。
 *
 * fixture：C1、C2；人員 tA（只 C1）、tX（只 C2）、tBoth（C1＋C2）、tNone（沒有分校）。
 * 帳號一律經 better-auth 的 API 建、刪，不直寫 ba_*（c2）。管理員只被指派 C1。
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

run('#2493 人員單筆讀寫看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const auth = createAuth(
    {
      DATABASE_URL: DB ?? '',
      BETTER_AUTH_SECRET: 'contract-secret-at-least-32-characters-long',
      BETTER_AUTH_URL: 'http://localhost:8787',
      WEB_URL: 'http://localhost:4200',
      ALLOWED_ORIGINS: '',
      LINE_CLIENT_ID: '',
      LINE_CLIENT_SECRET: '',
    } as never,
    () => undefined,
  );
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '', c2: '', tA: '', tX: '', tBoth: '', tNone: '' };
  const users: string[] = [];

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：人員範圍')", []);
    fx.c1 = await one("insert into campuses (org_id, name) values ($1, 'C1')", [ctx.orgId]);
    fx.c2 = await one("insert into campuses (org_id, name) values ($1, 'C2')", [ctx.orgId]);
    const staff = async (name: string, campuses: string[]) => {
      const { user } = (await auth.api.createUser({
        body: { email: `c2493-${crypto.randomUUID()}@phone.internal`, name },
      })) as { user: { id: string } };
      users.push(user.id);
      await q("insert into user_roles (user_id, role) values ($1, 'teacher')", [user.id]);
      const id = await one(
        'insert into staff (org_id, user_id, display_name) values ($1, $2, $3)',
        [ctx.orgId, user.id, name],
      );
      for (const campus of campuses)
        await q('insert into staff_campuses (staff_id, campus_id) values ($1, $2)', [id, campus]);
      return id;
    };
    fx.tA = await staff('甲老師', [fx.c1]);
    fx.tX = await staff('乙老師', [fx.c2]);
    fx.tBoth = await staff('跨校老師', [fx.c1, fx.c2]);
    fx.tNone = await staff('沒分校', []);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    await q(
      'delete from staff_campuses where staff_id in (select id from staff where org_id = $1)',
      [ctx.orgId],
    );
    await q('delete from staff where org_id = $1', [ctx.orgId]);
    const authCtx = await auth.$context;
    for (const userId of users) {
      await q('delete from user_roles where user_id = $1', [userId]);
      await authCtx.internalAdapter.deleteUser(userId);
    }
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
        `/api/staff${path}`,
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
  const row = async (id: string) =>
    (
      await q<{ notes: string | null; status: string }>(
        'select notes, status from staff where id = $1',
        [id],
      )
    )[0]!;
  const campusesOf = async (id: string) =>
    (
      await q<{ campus_id: string }>(
        'select campus_id from staff_campuses where staff_id = $1 order by campus_id',
        [id],
      )
    ).map((r) => r.campus_id);

  it('GET /:id：受限 C1 讀得到 C1 與跨校人員；C2、沒分校的 → 404；空範圍都 404；不受限照常', async () => {
    expect((await call('c1', 'GET', `/${fx.tA}`)).status).toBe(200);
    expect((await call('c1', 'GET', `/${fx.tBoth}`)).status).toBe(200);
    const out = await call('c1', 'GET', `/${fx.tX}`);
    expect(out.status).toBe(404);
    expect(JSON.stringify(await out.json())).not.toContain('乙老師');
    expect((await call('c1', 'GET', `/${fx.tNone}`)).status).toBe(404);
    expect((await call('none', 'GET', `/${fx.tA}`)).status).toBe(404);
    expect((await call('all', 'GET', `/${fx.tX}`)).status).toBe(200);
  });

  it('PUT /:id：受限 C1 改 C2 人員與跨校人員 → 404、不變；搶人（分校改成 C1）→ 404；C1 人員照常', async () => {
    expect((await call('c1', 'PUT', `/${fx.tX}`, { notes: '偷改' })).status).toBe(404);
    expect((await row(fx.tX)).notes).toBeNull();
    expect((await call('c1', 'PUT', `/${fx.tBoth}`, { notes: '偷改' })).status).toBe(404);
    expect((await row(fx.tBoth)).notes).toBeNull();
    expect((await call('c1', 'PUT', `/${fx.tX}`, { campusIds: [fx.c1] })).status).toBe(404);
    expect(await campusesOf(fx.tX)).toEqual([fx.c2]);
    expect((await call('c1', 'PUT', `/${fx.tA}`, { notes: '範圍內' })).status).toBe(200);
    expect((await row(fx.tA)).notes).toBe('範圍內');
  });

  it('archive／deactivate／activate：受限 C1 對 C2 與跨校人員 → 404、狀態不變', async () => {
    for (const action of ['archive', 'deactivate', 'activate']) {
      for (const id of [fx.tX, fx.tBoth, fx.tNone]) {
        expect((await call('c1', 'PATCH', `/${id}/${action}`)).status).toBe(404);
        expect((await row(id)).status).toBe('active');
      }
    }
    expect((await call('c1', 'PATCH', `/${fx.tA}/deactivate`)).status).toBe(200);
    expect((await row(fx.tA)).status).toBe('inactive');
  });
});
