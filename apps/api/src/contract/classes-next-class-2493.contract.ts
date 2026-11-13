// scope-contract: POST /api/classes
// scope-contract: PUT /api/classes/:id
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493 W7：班級的「下一期」要同 org、同分校範圍**（保留類：授權範圍），對真的本機 PostgREST＋Postgres 跑。
 *
 * POST `nextClassId` 原本連 org 都沒驗（c1，只靠 FK）、PUT 只驗 org：A 班的下一期可以指到別校
 *（或別 org）的班，學年升級時學生會被帶過去。裁定（11-13）：不在 org 或不在範圍＝404 不寫。
 * 班級本身的範圍（開班看課程分校、PUT 看 classScopeGuard）早就有，這裡只釘 nextClassId 這個載體。
 *
 * fixture：C1 有 A、A2 兩班，C2 有 X 班；別 org 有 Z 班。管理員只被指派 C1。
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

run('#2493 班級下一期看 org 與分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '', courseA: '', a: '', a2: '', x: '', z: '' };
  let otherOrg = '';

  const seedOrg = async (orgId: string, campusName: string) => {
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      orgId,
      `英文 ${campusName}`,
    ]);
    const campus = await one('insert into campuses (org_id, name) values ($1, $2)', [
      orgId,
      campusName,
    ]);
    const course = await one(
      'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
      [orgId, campus, `英文 ${campusName}`, subject],
    );
    const klass = (name: string) =>
      one('insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)', [
        orgId,
        campus,
        course,
        name,
      ]);
    return { campus, course, klass };
  };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：下一期班級')", []);
    const c1 = await seedOrg(ctx.orgId, 'C1');
    fx.c1 = c1.campus;
    fx.courseA = c1.course;
    fx.a = await c1.klass('A');
    fx.a2 = await c1.klass('A2');
    fx.x = await (await seedOrg(ctx.orgId, 'C2')).klass('X');
    otherOrg = await one("insert into organizations (name) values ('#2493 契約：別 org 班')", []);
    fx.z = await (await seedOrg(otherOrg, 'Z 校')).klass('Z');
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    for (const orgId of [ctx.orgId, otherOrg].filter(Boolean)) {
      for (const sql of [
        'update classes set next_class_id = null where org_id = $1',
        'delete from classes where org_id = $1',
        'delete from courses where org_id = $1',
        'delete from subjects where org_id = $1',
        'delete from campuses where org_id = $1',
        'delete from audit_logs where org_id = $1',
        'delete from organizations where id = $1',
      ]) {
        await q(sql, [orgId]);
      }
    }
  }, 120_000);

  type Scope = 'all' | 'c1';
  const call = async (scope: Scope, method: string, path: string, body: unknown) => {
    ctx.campusScope = scope === 'all' ? null : [fx.c1];
    try {
      return await app.request(
        `/api/classes${path}`,
        {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        env,
      );
    } finally {
      ctx.campusScope = null;
    }
  };
  const classCount = async () =>
    Number(
      (await q<{ n: string }>('select count(*) n from classes where org_id = $1', [ctx.orgId]))[0]!
        .n,
    );
  const nextOf = async (id: string) =>
    (
      await q<{ next_class_id: string | null }>('select next_class_id from classes where id = $1', [
        id,
      ])
    )[0]!.next_class_id;

  it('POST：下一期指到 C2 的班（受限）或別 org 的班（不受限也不行）→ 404、沒建；指到 C1 的班 → 201', async () => {
    const before = await classCount();
    const body = (name: string, nextClassId: string) => ({
      courseId: fx.courseA,
      name,
      nextClassId,
    });
    expect((await call('c1', 'POST', '', body('新班 1', fx.x))).status).toBe(404);
    expect((await call('all', 'POST', '', body('新班 2', fx.z))).status).toBe(404);
    expect(await classCount()).toBe(before);
    expect((await call('c1', 'POST', '', body('新班 3', fx.a2))).status).toBe(201);
  });

  it('PUT /:id：受限 C1 把 A 的下一期改成 C2 的班 → 404、不變；改成 A2 → 200', async () => {
    expect((await call('c1', 'PUT', `/${fx.a}`, { nextClassId: fx.x })).status).toBe(404);
    expect(await nextOf(fx.a)).toBeNull();
    expect((await call('c1', 'PUT', `/${fx.a}`, { nextClassId: fx.a2 })).status).toBe(200);
    expect(await nextOf(fx.a)).toBe(fx.a2);
  });
});
