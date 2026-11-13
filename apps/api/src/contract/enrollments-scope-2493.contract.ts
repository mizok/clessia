// scope-contract: PATCH /api/enrollments/:id
// scope-contract: PATCH /api/enrollments/:id/status
// scope-contract: DELETE /api/enrollments/:id
// scope-contract: POST /api/enrollments/batch-match
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493 W1／R9：報名的改、改狀態、刪與批次比對看分校範圍**（保留類：授權範圍＋金額＋扣堂上游），
 * 對真的本機 PostgREST＋Postgres 跑。
 *
 * 原本四支只看 org：受限管理員改得到別校報名的議價與起迄、退得掉別校學生、刪得掉別校報名；
 * 批次比對帶別校班 id 推得出那班名冊，候選學生撈全 org。裁定（11-13）：範圍外＝404、什麼都不寫，
 * 同 #2443；候選只留範圍內學生（studentInScope，同列表）。
 *
 * fixture：C1 有 A、B 兩班，C2 有 X 班。學校 S 有兩位「王同名」：w1 報在 A、w2 報在 X。
 * eA＝w1 在 A、eX＝w2 在 X、eX2＝另一位在 X（給刪除用）。管理員只被指派 C1。
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

run('#2493 報名改／改狀態／刪／批次比對看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '', c2: '', a: '', b: '', x: '', w1: '', w2: '', eA: '', eX: '', eX2: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：報名範圍')", []);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '英文',
    ]);
    const klass = async (campus: string, name: string) => {
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, `英文 ${name}`, subject],
      );
      return one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, course, name],
      );
    };
    fx.c1 = await one("insert into campuses (org_id, name) values ($1, 'C1')", [ctx.orgId]);
    fx.c2 = await one("insert into campuses (org_id, name) values ($1, 'C2')", [ctx.orgId]);
    fx.a = await klass(fx.c1, 'A');
    fx.b = await klass(fx.c1, 'B');
    fx.x = await klass(fx.c2, 'X');
    const school = await one("insert into schools (org_id, name) values ($1, 'S 國中')", [
      ctx.orgId,
    ]);
    const student = (name: string) =>
      one("insert into students (org_id, name, grade, school_id) values ($1, $2, 'J2', $3)", [
        ctx.orgId,
        name,
        school,
      ]);
    fx.w1 = await student('王同名');
    fx.w2 = await student('王同名');
    const other = await student('李別人');
    const enroll = (classId: string, studentId: string) =>
      one(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
        [ctx.orgId, classId, studentId],
      );
    fx.eA = await enroll(fx.a, fx.w1);
    fx.eX = await enroll(fx.x, fx.w2);
    fx.eX2 = await enroll(fx.x, other);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from enrollments where org_id = $1',
      'delete from students where org_id = $1',
      'delete from schools where org_id = $1',
      'delete from classes where org_id = $1',
      'delete from courses where org_id = $1',
      'delete from subjects where org_id = $1',
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
        `/api/enrollments${path}`,
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
      await q<{ agreed_amount: number; status: string }>(
        'select agreed_amount::int as agreed_amount, status from enrollments where id = $1',
        [id],
      )
    )[0];

  it('PATCH /:id：受限 C1 改 C2 的報名 → 404、議價不變；空範圍連 C1 的也改不了；C1 的照常', async () => {
    expect((await call('c1', 'PATCH', `/${fx.eX}`, { agreedAmount: 1 })).status).toBe(404);
    expect((await row(fx.eX))!.agreed_amount).toBe(1000);

    expect((await call('none', 'PATCH', `/${fx.eA}`, { agreedAmount: 1 })).status).toBe(404);
    expect((await row(fx.eA))!.agreed_amount).toBe(1000);

    expect((await call('c1', 'PATCH', `/${fx.eA}`, { agreedAmount: 900 })).status).toBe(200);
    expect((await row(fx.eA))!.agreed_amount).toBe(900);
  });

  it('PATCH /:id/status：受限 C1 停 C2 的報名 → 404、仍是 active；C1 的照常', async () => {
    const suspend = { status: 'suspended', notes: '契約' };
    expect((await call('c1', 'PATCH', `/${fx.eX}/status`, suspend)).status).toBe(404);
    expect((await row(fx.eX))!.status).toBe('active');

    expect((await call('none', 'PATCH', `/${fx.eA}/status`, suspend)).status).toBe(404);
    expect((await row(fx.eA))!.status).toBe('active');

    expect((await call('c1', 'PATCH', `/${fx.eA}/status`, suspend)).status).toBe(200);
    expect((await row(fx.eA))!.status).toBe('suspended');
  });

  it('DELETE /:id：受限 C1、空範圍刪 C2 的報名 → 404、還在；不受限照常', async () => {
    expect((await call('c1', 'DELETE', `/${fx.eX2}`)).status).toBe(404);
    expect((await call('none', 'DELETE', `/${fx.eX2}`)).status).toBe(404);
    expect(await row(fx.eX2)).toBeDefined();

    expect((await call('all', 'DELETE', `/${fx.eX2}`)).status).toBe(204);
    expect(await row(fx.eX2)).toBeUndefined();
  });

  it('POST /batch-match：受限 C1 指名 C2 的班 → 404；候選只有範圍內的「王同名」，不吐 C2 那位', async () => {
    const items = [{ name: '王同名', school: 'S 國中' }];
    expect((await call('c1', 'POST', '/batch-match', { classId: fx.x, items })).status).toBe(404);
    expect((await call('none', 'POST', '/batch-match', { classId: fx.b, items })).status).toBe(404);

    const scoped = await call('c1', 'POST', '/batch-match', { classId: fx.b, items });
    expect(scoped.status).toBe(200);
    const body = await scoped.json();
    expect(body).toEqual({ results: [{ index: 0, status: 'matched', studentId: fx.w1 }] });
    expect(JSON.stringify(body)).not.toContain(fx.w2);

    // 不受限照舊：兩位同名 → ambiguous
    const all = await (await call('all', 'POST', '/batch-match', { classId: fx.b, items })).json();
    expect(all.results[0].status).toBe('ambiguous');
    expect(all.results[0].candidates).toHaveLength(2);
  });
});
