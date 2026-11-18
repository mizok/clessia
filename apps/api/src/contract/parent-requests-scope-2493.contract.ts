// scope-contract: GET /api/parent-requests
// scope-contract: PATCH /api/parent-requests/:kind/:id
// scope-contract: POST /api/parent-requests/enrollment/:id/approve
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493：家長申請（列表、改狀態、核准報名）看分校範圍**（保留類：授權範圍、金額路徑），
 * 對真的本機 PostgREST＋Postgres 跑。
 *
 * 申請表沒有分校欄：報名申請看班的 campus_id、試聽申請看課程的 campus_id。範圍外跟不存在一樣 404；
 * 核准會建報名＋開帳單，範圍外的申請不能被核准（什麼都不能寫）。
 *
 * fixture：C1 有 A 班／課、C2 有 X 班／課；報名申請 erA1／erA2（A）、erX1／erX2（X），試聽申請 trA／trX。
 * 管理員只被指派 C1。
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

run('#2493 家長申請看分校範圍', () => {
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
      "insert into organizations (name) values ('#2493 契約：家長申請範圍')",
      [],
    );
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '英文',
    ]);
    fx['ft'] = await one(
      "insert into fee_templates (org_id, name, billing_mode, amount) values ($1, '月費', 'monthly', 3100)",
      [ctx.orgId],
    );
    for (const key of ['c1', 'c2'] as const) {
      fx[key] = await one('insert into campuses (org_id, name) values ($1, $2)', [ctx.orgId, key]);
      fx[`course_${key}`] = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, fx[key], `英文 ${key}`, subject],
      );
      fx[`class_${key}`] = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, fx[key], fx[`course_${key}`], `班 ${key}`],
      );
    }
    const student = (name: string) =>
      one("insert into students (org_id, name, grade) values ($1, $2, 'J2')", [ctx.orgId, name]);
    const enrollReq = async (key: string, cls: string) => {
      fx[key] = await one(
        `insert into enrollment_requests (org_id, student_id, class_id, status, requested_by)
         values ($1, $2, $3, 'pending', $4)`,
        [ctx.orgId, await student(key), fx[cls], ctx.userId],
      );
    };
    await enrollReq('erA1', 'class_c1');
    await enrollReq('erA2', 'class_c1');
    await enrollReq('erX1', 'class_c2');
    await enrollReq('erX2', 'class_c2');
    for (const [key, course] of [
      ['trA', 'course_c1'],
      ['trX', 'course_c2'],
    ] as const) {
      fx[key] = await one(
        `insert into trial_requests (org_id, student_id, course_id, status, requested_by)
         values ($1, $2, $3, 'pending', $4)`,
        [ctx.orgId, await student(key), fx[course], ctx.userId],
      );
    }
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from invoice_items where invoice_id in (select id from invoices where org_id = $1)',
      'delete from invoices where org_id = $1',
      'delete from enrollment_requests where org_id = $1',
      'delete from trial_requests where org_id = $1',
      'delete from enrollments where org_id = $1',
      'delete from fee_templates where org_id = $1',
      'delete from students where org_id = $1',
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
        `/api/parent-requests${path}`,
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
  const status = async (table: 'enrollment_requests' | 'trial_requests', id: string) =>
    (await q<{ s: string }>(`select status::text s from ${table} where id = $1`, [id]))[0]!.s;
  const written = async () =>
    (
      await q<{ e: number; i: number }>(
        `select (select count(*)::int from enrollments where org_id = $1) e,
                (select count(*)::int from invoices where org_id = $1) i`,
        [ctx.orgId],
      )
    )[0]!;

  it('GET：受限 C1 只列 C1 班／課的申請；空範圍空；不受限全部（報名＋試聽）', async () => {
    const ids = async (scope: Scope) =>
      ((await (await call(scope, 'GET', '')).json()) as { data: Array<{ id: string }> }).data
        .map((r) => r.id)
        .sort();
    expect(await ids('c1')).toEqual([fx['erA1']!, fx['erA2']!, fx['trA']!].sort());
    expect(await ids('none')).toEqual([]);
    expect(await ids('all')).toEqual(
      [fx['erA1']!, fx['erA2']!, fx['erX1']!, fx['erX2']!, fx['trA']!, fx['trX']!].sort(),
    );
  });

  it('PATCH 報名拒絕：受限 C1 拒 C2 的 → 404 且仍待審；空範圍 404；C1 的照常；不受限拒 C2 的照常', async () => {
    const reject = (scope: Scope, id: string) =>
      call(scope, 'PATCH', `/enrollment/${id}`, { status: 'rejected', rejectReason: '契約' });
    expect((await reject('c1', fx['erX1']!)).status).toBe(404);
    expect(await status('enrollment_requests', fx['erX1']!)).toBe('pending');
    expect((await reject('none', fx['erA1']!)).status).toBe(404);
    expect(await status('enrollment_requests', fx['erA1']!)).toBe('pending');
    expect((await reject('c1', fx['erA1']!)).status).toBe(200);
    expect(await status('enrollment_requests', fx['erA1']!)).toBe('rejected');
    expect((await reject('all', fx['erX1']!)).status).toBe(200);
    expect(await status('enrollment_requests', fx['erX1']!)).toBe('rejected');
  });

  it('PATCH 試聽：受限 C1 改 C2 的 → 404 不變；C1 的照常；不受限改 C2 的照常', async () => {
    const complete = (scope: Scope, id: string) =>
      call(scope, 'PATCH', `/trial/${id}`, { status: 'completed' });
    expect((await complete('c1', fx['trX']!)).status).toBe(404);
    expect(await status('trial_requests', fx['trX']!)).toBe('pending');
    expect((await complete('c1', fx['trA']!)).status).toBe(200);
    expect(await status('trial_requests', fx['trA']!)).toBe('completed');
    expect((await complete('all', fx['trX']!)).status).toBe(200);
    expect(await status('trial_requests', fx['trX']!)).toBe('completed');
  });

  it('POST 核准：受限 C1 核准 C2 的 → 404、沒建報名沒開帳單、申請仍待審；空範圍 404；C1 的核准成功；不受限核准 C2 的成功', async () => {
    const approve = (scope: Scope, id: string) =>
      call(scope, 'POST', `/enrollment/${id}/approve`, {
        billingMode: 'monthly',
        feeTemplateId: fx['ft'],
        effectiveFrom: '2026-10-22',
        skipConflictCheck: true,
      });
    const before = await written();
    expect((await approve('c1', fx['erX2']!)).status).toBe(404);
    expect((await approve('none', fx['erA2']!)).status).toBe(404);
    expect(await written()).toEqual(before);
    expect(await status('enrollment_requests', fx['erX2']!)).toBe('pending');
    expect(await status('enrollment_requests', fx['erA2']!)).toBe('pending');

    expect((await approve('c1', fx['erA2']!)).status).toBe(200);
    expect(await written()).toEqual({ e: before.e + 1, i: before.i + 1 });
    expect(await status('enrollment_requests', fx['erA2']!)).toBe('awaiting_payment');

    expect((await approve('all', fx['erX2']!)).status).toBe(200);
    expect(await written()).toEqual({ e: before.e + 2, i: before.i + 2 });
  });
});
