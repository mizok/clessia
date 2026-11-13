import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2437 (3)：開課班目錄的名額在班數多時照樣算得出來**，對真的本機 PostgREST 跑。
 *
 * 公開目錄（`GET /api/public/catalog`）與家長目錄（`GET /api/me/catalog`）的名額：
 * 班數＝公開／開課的班，隨規模長大。fixture：BIG 個開放班、每班 SEATS 位在籍＋一筆已退班，
 * 報名列總數破 PostgREST 的 max_rows（1000）。
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

const ctx = { orgId: '', userId: '', child: '' };

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
      set('roles', ['parent']);
      set('permissions', []);
      set('activeRole', 'parent');
      set('studentScope', [ctx.child]);
      set('childDb', createChildDb(supabase as never, [ctx.child], ctx.orgId));
      set('campusScope', null);
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

const BIG = 260;
const SEATS = 5;
const MAX = 10;

run('#2437 (3) 開課班目錄的名額（班數破 200、報名列破 1000）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const slug = `contract-2437-${Date.now()}`;
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;

  beforeAll(async () => {
    const [parent] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'parent' order by user_id limit 1",
    );
    ctx.userId = parent!.user_id;
    ctx.orgId = await one('insert into organizations (name, slug) values ($1, $2)', [
      '#2437 契約：目錄名額',
      slug,
    ]);
    const campus = await one('insert into campuses (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '本校',
    ]);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    const course = await one(
      'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
      [ctx.orgId, campus, '數學', subject],
    );
    const classIds = (
      await q<{ id: string }>(
        `insert into classes (org_id, campus_id, course_id, name, max_students, is_active, is_public_enrollment)
         select $1, $2, $3, '班 ' || lpad(n::text, 3, '0'), ${MAX}, true, true
         from generate_series(1, ${BIG}) n returning id`,
        [ctx.orgId, campus, course],
      )
    ).map((r) => r.id);
    const students = (
      await q<{ id: string }>(
        `insert into students (org_id, name, grade) select $1, '生 ' || n, 'J2'
         from generate_series(1, ${SEATS + 1}) n returning id`,
        [ctx.orgId],
      )
    ).map((r) => r.id);
    ctx.child = students[0]!;
    const enroll = (who: string[], status: string) =>
      q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         select $1, c, s, $4, 'monthly', 1000, '2026-01-01'
         from unnest($2::uuid[]) c cross join unnest($3::uuid[]) s`,
        [ctx.orgId, classIds, who, status],
      );
    await enroll(students.slice(0, SEATS), 'active');
    await enroll(students.slice(SEATS), 'withdrawal');
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

  type Catalog = { data: Array<{ classId: string; remainingSeats: number }> };
  const seats = (body: Catalog) => [...new Set(body.data.map((r) => r.remainingSeats))];

  it(`公開目錄：${BIG} 班全列出，每班剩 ${MAX - SEATS} 位（已退班不佔名額）`, async () => {
    const res = await app.request(
      '/api/public/catalog',
      {},
      {
        ...env,
        SUPABASE_URL: URL!,
        SUPABASE_SECRET_KEY: KEY!,
        PUBLIC_ORG_SLUG: slug,
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Catalog;
    expect(body.data).toHaveLength(BIG);
    expect(seats(body)).toEqual([MAX - SEATS]);
  });

  it(`家長目錄：${BIG} 班全列出，每班剩 ${MAX - SEATS} 位`, async () => {
    const res = await app.request(`/api/me/catalog?childId=${ctx.child}`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Catalog;
    expect(body.data).toHaveLength(BIG);
    expect(seats(body)).toEqual([MAX - SEATS]);
  });
});
