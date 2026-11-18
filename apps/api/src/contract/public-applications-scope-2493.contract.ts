// scope-contract: GET /api/public-applications
// scope-contract: PATCH /api/public-applications/:id
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493：公開申請（列表、改狀態／備註）看分校範圍**（保留類：授權範圍），對真的本機 PostgREST＋Postgres 跑。
 *
 * 申請表沒有分校欄：看目標班（或試聽課程）的 campus_id，任一目標在範圍內即可見。**沒有任何目標的申請
 * 對受限者不可見**（fail-closed），範圍外跟不存在一樣 404。
 *
 * fixture：C1 有 A 班、C2 有 X 班；申請 pA（目標 A）、pX（目標 X）、pN（沒有目標）。管理員只被指派 C1。
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

run('#2493 公開申請看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx: Record<string, string> = {};

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one(
      "insert into organizations (name) values ('#2493 契約：公開申請範圍')",
      [],
    );
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '英文',
    ]);
    for (const key of ['c1', 'c2'] as const) {
      fx[key] = await one('insert into campuses (org_id, name) values ($1, $2)', [ctx.orgId, key]);
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, fx[key], `英文 ${key}`, subject],
      );
      fx[`class_${key}`] = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, fx[key], course, `班 ${key}`],
      );
    }
    const application = async (key: string, classId: string | null) => {
      fx[key] = await one(
        `insert into public_applications
           (org_id, kind, parent_name, parent_email, parent_relation, student_name, student_grade, student_school, consented_at)
         values ($1, 'enrollment', $2, 'p@example.com', '母親', $2, 'J2', '某國中', now())`,
        [ctx.orgId, key],
      );
      if (classId) {
        await q(
          'insert into public_application_targets (application_id, class_id) values ($1, $2)',
          [fx[key], classId],
        );
      }
    };
    await application('pA', fx['class_c1']!);
    await application('pX', fx['class_c2']!);
    await application('pN', null);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from public_application_targets where application_id in (select id from public_applications where org_id = $1)',
      'delete from public_applications where org_id = $1',
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
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx['c1']!] : [];
    try {
      return await app.request(
        `/api/public-applications${path}`,
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
      await q<{ status: string; staff_note: string | null }>(
        'select status::text, staff_note from public_applications where id = $1',
        [id],
      )
    )[0]!;

  it('GET：受限 C1 只列目標在 C1 的；沒有目標的不列；空範圍空；不受限全部', async () => {
    const ids = async (scope: Scope) =>
      ((await (await call(scope, 'GET', '')).json()) as { data: Array<{ id: string }> }).data
        .map((r) => r.id)
        .sort();
    expect(await ids('c1')).toEqual([fx['pA']!]);
    expect(await ids('none')).toEqual([]);
    expect(await ids('all')).toEqual([fx['pA']!, fx['pX']!, fx['pN']!].sort());
  });

  it('PATCH：受限 C1 改 C2／無目標的申請 → 404 狀態與備註不變；空範圍 404；C1 的照常；不受限改 C2 的照常', async () => {
    const patch = (scope: Scope, id: string) =>
      call(scope, 'PATCH', `/${id}`, { status: 'contacted', staffNote: '契約' });
    expect((await patch('c1', fx['pX']!)).status).toBe(404);
    expect((await patch('c1', fx['pN']!)).status).toBe(404);
    expect(await row(fx['pX']!)).toEqual({ status: 'new', staff_note: null });
    expect(await row(fx['pN']!)).toEqual({ status: 'new', staff_note: null });
    expect((await patch('none', fx['pA']!)).status).toBe(404);
    expect(await row(fx['pA']!)).toEqual({ status: 'new', staff_note: null });

    expect((await patch('c1', fx['pA']!)).status).toBe(200);
    expect(await row(fx['pA']!)).toEqual({ status: 'contacted', staff_note: '契約' });
    expect((await patch('all', fx['pX']!)).status).toBe(200);
    expect(await row(fx['pX']!)).toEqual({ status: 'contacted', staff_note: '契約' });
  });
});
