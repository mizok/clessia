// scope-contract: POST /api/login-links
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493（#966 A 批）：產生登入連結看呼叫者的分校範圍**（保留類：授權範圍——連結就是帳號），
 * 對真的本機 PostgREST＋Postgres 跑。
 *
 * 對象看得到的分校必須全部在呼叫者範圍內（子集，不是交集）。ba_user 的 orgId 要等於呼叫者的 org，
 * 所以這支用 seed 的 org 與帳號（ba_* 只讀，c2）、**不寫任何資料**；只把「真的寄出連結」那一步
 * （better-auth magic link）換成假的，範圍判斷與查詢走真的。
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

vi.mock('../routes/login-links/mint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../routes/login-links/mint')>()),
  mintLoginLinkForRequest: async () => 'https://example.test/magic-link',
}));

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

run('#2493 登入連結看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  /** 不受限的管理員（觸及全部分校）、只碰一個分校的家長、另一個該家長碰不到的分校 */
  const fx = {
    open: '',
    parent: '',
    reach: '',
    other: '',
    multi: '',
    multiCampuses: [] as string[],
  };

  beforeAll(async () => {
    const [open] = await q<{ id: string; org: string }>(
      `select u.id, u."orgId" org from ba_user u
        where exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'admin')
          and not exists (select 1 from staff s where s.user_id = u.id)
          and u.email is not null
        order by u.id limit 1`,
    );
    ctx.userId = open!.id;
    ctx.orgId = open!.org;
    fx.open = open!.id;
    const [parent] = await q<{ id: string; campus: string }>(
      `select u.id, min(c.campus_id::text) campus
         from ba_user u
         join parents p on p.user_id = u.id and p.org_id = u."orgId"
         join parent_student_relations r on r.parent_id = p.id
         join enrollments e on e.student_id = r.student_id
         join classes c on c.id = e.class_id
        where u."orgId" = $1 and u.email is not null
          and not exists (select 1 from user_roles x where x.user_id = u.id and x.role <> 'parent')
        group by u.id
       having count(distinct c.campus_id) = 1
        order by u.id limit 1`,
      [ctx.orgId],
    );
    fx.parent = parent!.id;
    fx.reach = parent!.campus;
    const multi = await q<{ id: string; campus: string }>(
      `select u.id, c.campus_id::text campus
         from ba_user u
         join parents p on p.user_id = u.id and p.org_id = u."orgId"
         join parent_student_relations r on r.parent_id = p.id
         join enrollments e on e.student_id = r.student_id
         join classes c on c.id = e.class_id
        where u."orgId" = $1 and u.email is not null
          and not exists (select 1 from user_roles x where x.user_id = u.id and x.role <> 'parent')
          and u.id = (
            select u2.id from ba_user u2
              join parents p2 on p2.user_id = u2.id and p2.org_id = u2."orgId"
              join parent_student_relations r2 on r2.parent_id = p2.id
              join enrollments e2 on e2.student_id = r2.student_id
              join classes c2 on c2.id = e2.class_id
             where u2."orgId" = $1 and u2.email is not null
               and not exists (select 1 from user_roles x2 where x2.user_id = u2.id and x2.role <> 'parent')
             group by u2.id having count(distinct c2.campus_id) = 2
             order by u2.id limit 1)
        group by u.id, c.campus_id order by c.campus_id`,
      [ctx.orgId],
    );
    fx.multi = multi[0]!.id;
    fx.multiCampuses = multi.map((r) => r.campus);
    fx.other = (
      await q<{ id: string }>('select id from campuses where org_id = $1 and id <> $2 limit 1', [
        ctx.orgId,
        fx.reach,
      ])
    )[0]!.id;
    app = (await import('../index')).default as never;
  }, 120_000);

  type Scope = 'all' | 'reach' | 'other' | 'none' | 'half' | 'both';
  const mint = async (scope: Scope, userId: string) => {
    ctx.campusScope =
      scope === 'half'
        ? [fx.multiCampuses[0]!]
        : scope === 'both'
          ? fx.multiCampuses
          : scope === 'all'
            ? null
            : scope === 'reach'
              ? [fx.reach]
              : scope === 'other'
                ? [fx.other]
                : [];
    try {
      const res = await app.request(
        '/api/login-links',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId }),
        },
        env,
      );
      return { status: res.status, body: (await res.json()) as { code?: string; url?: string } };
    } finally {
      ctx.campusScope = null;
    }
  };

  it('對象是不受限的管理員：受限呼叫者 → 403 OUT_OF_SCOPE、沒有連結；不受限呼叫者 200', async () => {
    for (const scope of ['reach', 'other', 'none'] as const) {
      const r = await mint(scope, fx.open);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('OUT_OF_SCOPE');
      expect(r.body.url).toBeUndefined();
    }
    const ok = await mint('all', fx.open);
    expect(ok.status).toBe(200);
    expect(ok.body.url).toBeTruthy();
  });

  it('對象是只碰一個分校的家長：範圍不含那個分校（含空範圍）→ 403 OUT_OF_SCOPE；範圍含它 → 200', async () => {
    for (const scope of ['other', 'none'] as const) {
      const r = await mint(scope, fx.parent);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('OUT_OF_SCOPE');
      expect(r.body.url).toBeUndefined();
    }
    expect((await mint('reach', fx.parent)).status).toBe(200);
    expect((await mint('all', fx.parent)).status).toBe(200);
  });
  it('對象碰兩個分校的家長：只涵蓋其中一個 → 403（子集，不是交集）；兩個都涵蓋 → 200', async () => {
    const half = await mint('half', fx.multi);
    expect(half.status).toBe(403);
    expect(half.body.code).toBe('OUT_OF_SCOPE');
    expect(half.body.url).toBeUndefined();
    expect((await mint('both', fx.multi)).status).toBe(200);
  });
});
