import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2443：直接報名三條路（`POST /api/enrollments`、`/batch`、`/copy-from-class`）看分校範圍**
 *（保留類：授權範圍），對真的本機 PostgREST＋Postgres 跑。
 *
 * 原本三條都走 `enrollWithSeatLock`、完全不看 `campusScope`：受限管理員可以把學生報進別校的班。
 * 裁定（11-12）：範圍外＝404、什麼都不寫，同核准路徑（`enrollment-approve.ts`）。
 *
 * fixture：C1 有 A（來源班，有在籍學生）、B 兩班；C2 有 X 一班。管理員只被指派 C1。
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

run('#2443 直接報名三條路看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '', c2: '', a: '', b: '', x: '', solo: '', pair: [] as string[] };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2443 契約：報名範圍')", []);
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
    const students = (
      await q<{ id: string }>(
        `insert into students (org_id, name, grade) select $1, '生 ' || n, 'J2'
         from generate_series(1, 5) n returning id`,
        [ctx.orgId],
      )
    ).map((r) => r.id);
    fx.solo = students[0]!;
    fx.pair = students.slice(1, 3);
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       select $1, $2, unnest($3::uuid[]), 'active', 'monthly', 1000, '2026-01-01'`,
      [ctx.orgId, fx.a, students.slice(3)],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from enrollments where org_id = $1',
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

  const post = async (path: string, body: unknown) => {
    ctx.campusScope = [fx.c1];
    try {
      return await app.request(
        `/api/enrollments${path}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        env,
      );
    } finally {
      ctx.campusScope = null;
    }
  };
  const rowsIn = async (classId: string) =>
    Number(
      (
        await q<{ n: string }>('select count(*) n from enrollments where class_id = $1', [classId])
      )[0]!.n,
    );

  it('POST /：受限 C1 報進 C2 的班 → 404、沒寫；報進 C1 的班 → 201', async () => {
    const out = await post('', { classId: fx.x, studentId: fx.solo });
    expect(out.status).toBe(404);
    expect(await rowsIn(fx.x)).toBe(0);

    const ok = await post('', { classId: fx.b, studentId: fx.solo });
    expect(ok.status).toBe(201);
    expect(await rowsIn(fx.b)).toBe(1);
  });

  it('POST /batch：受限 C1 報進 C2 的班 → 404、沒寫；報進 C1 的班 → 200 兩位', async () => {
    const out = await post('/batch', { classId: fx.x, studentIds: fx.pair });
    expect(out.status).toBe(404);
    expect(await rowsIn(fx.x)).toBe(0);

    const ok = await post('/batch', { classId: fx.a, studentIds: fx.pair });
    expect(ok.status).toBe(200);
    expect(await rowsIn(fx.a)).toBe(4);
  });

  it('POST /copy-from-class：受限 C1 複製進 C2 的班 → 404、沒寫；複製進 C1 的班 → 200', async () => {
    const body = (targetClassId: string) => ({
      sourceClassId: fx.a,
      targetClassId,
      statuses: ['active'],
    });
    const out = await post('/copy-from-class', body(fx.x));
    expect(out.status).toBe(404);
    expect(await rowsIn(fx.x)).toBe(0);

    const ok = await post('/copy-from-class', body(fx.b));
    expect(ok.status).toBe(200);
    expect(await rowsIn(fx.b)).toBeGreaterThan(1);
  });
});
