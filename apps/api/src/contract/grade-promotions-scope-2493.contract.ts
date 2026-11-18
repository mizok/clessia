// scope-contract: GET /api/grade-promotions
// scope-contract: GET /api/grade-promotions/preview
// scope-contract: POST /api/grade-promotions
// scope-contract: POST /api/grade-promotions/:id/revert
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493：學年升級四支端點只准「所有分校」的管理員**（保留類：授權；批次改寫學生資料），
 * 對真的本機 PostgREST＋Postgres 跑。
 *
 * 升級是整個機構一次：受分校範圍限制的管理員（含空範圍）讀寫都 403 REQUIRES_ALL_CAMPUSES，
 * 預覽與歷史也不給（會列出全機構的學生）；403 時學生年級不動、不產生升級紀錄。
 * fixture：C1、C2；學生 sJ（J1，在 C2 的班）。管理員只被指派 C1。
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

const ctx = { orgId: '', userId: '', c1: '', campusScope: null as string[] | null };

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

run('#2493 學年升級只准所有分校的管理員', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { sJ: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：學年升級')", []);
    ctx.c1 = await one("insert into campuses (org_id, name) values ($1, 'C1')", [ctx.orgId]);
    fx.sJ = await one("insert into students (org_id, name, grade) values ($1, '待升級生', 'J1')", [
      ctx.orgId,
    ]);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from grade_promotions where org_id = $1',
      'delete from students where org_id = $1',
      'delete from campuses where org_id = $1',
      'delete from audit_logs where org_id = $1',
      'delete from organizations where id = $1',
    ]) {
      await q(sql, [ctx.orgId]);
    }
  }, 120_000);

  type Scope = 'all' | 'c1' | 'none';
  const call = async (scope: Scope, method: string, path: string) => {
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [ctx.c1] : [];
    try {
      return await app.request(`/api/grade-promotions${path}`, { method }, env);
    } finally {
      ctx.campusScope = null;
    }
  };
  const grade = async () =>
    (
      await q<{ grade: string }>('select grade::text as grade from students where id = $1', [fx.sJ])
    )[0]!.grade;
  const promotions = async () =>
    q<{ id: string; reverted_at: string | null }>(
      'select id, reverted_at from grade_promotions where org_id = $1',
      [ctx.orgId],
    );
  const denied = async (scope: Scope, method: string, path: string) => {
    const res = await call(scope, method, path);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('REQUIRES_ALL_CAMPUSES');
    expect(JSON.stringify(body)).not.toContain('待升級生');
  };

  it('GET /preview：受限 C1、空範圍 → 403；不受限 200 且算到這位學生', async () => {
    await denied('c1', 'GET', '/preview');
    await denied('none', 'GET', '/preview');
    const ok = await call('all', 'GET', '/preview');
    expect(ok.status).toBe(200);
    const t = ((await ok.json()) as { transitions: { from: string; count: number }[] }).transitions;
    expect(t.find((x) => x.from === 'J1')!.count).toBeGreaterThanOrEqual(1);
  });

  it('POST /：受限 C1、空範圍 → 403、年級不動、沒有升級紀錄；不受限 201 並升級', async () => {
    await denied('c1', 'POST', '');
    await denied('none', 'POST', '');
    expect(await grade()).toBe('J1');
    expect(await promotions()).toHaveLength(0);
    expect((await call('all', 'POST', '')).status).toBe(201);
    expect(await grade()).toBe('J2');
    expect(await promotions()).toHaveLength(1);
  });

  it('GET /：受限 C1、空範圍 → 403；不受限 200 看得到那次升級', async () => {
    await denied('c1', 'GET', '');
    await denied('none', 'GET', '');
    const ok = await call('all', 'GET', '');
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).toContain((await promotions())[0]!.id);
  });

  it('POST /:id/revert：受限 C1、空範圍 → 403、年級不動、沒被標復原；不受限 200 並復原', async () => {
    const [p] = await promotions();
    await denied('c1', 'POST', `/${p!.id}/revert`);
    await denied('none', 'POST', `/${p!.id}/revert`);
    expect(await grade()).toBe('J2');
    expect((await promotions())[0]!.reverted_at).toBeNull();
    expect((await call('all', 'POST', `/${p!.id}/revert`)).status).toBe(200);
    expect(await grade()).toBe('J1');
    expect((await promotions())[0]!.reverted_at).not.toBeNull();
  });
});
