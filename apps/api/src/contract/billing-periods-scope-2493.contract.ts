// scope-contract: GET /api/billing-periods/upcoming-unbilled
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493：待開單（upcoming-unbilled）只算受限者自己分校的期繳生與已開單**（保留類：授權範圍），
 * 對真的本機 PostgREST＋Postgres 跑。
 *
 * 「B 校開過單、A 校的待辦跟著消失」與「A 校主任看到全機構的待開單人數」都不會報錯 —— 只有分校條件
 * 沒下才會出現，所以逐一把兩支 head count 的範圍打進去。
 *
 * fixture：C1 有 1 位期繳生、C2 有 2 位。期 P1（5 天後開始）沒人開過單；期 P2（10 天後開始）
 * C2 的人已開單。管理員只被指派 C1。
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
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

run('#2493 待開單看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '', c2: '', p1: '', p2: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one(
      "insert into organizations (name, billing_reminder_days) values ('#2493 契約：待開單範圍', 30)",
      [],
    );
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    const today = "(now() at time zone 'Asia/Taipei')::date";
    const period = (name: string, from: number, to: number) =>
      one(
        `insert into billing_periods (org_id, name, start_date, end_date)
         values ($1, $2, ${today} + ${from}, ${today} + ${to})`,
        [ctx.orgId, name],
      );
    fx.p1 = await period('P1', 5, 35);
    fx.p2 = await period('P2', 10, 40);
    const enrollIds: Record<string, string[]> = { c1: [], c2: [] };
    for (const [key, n] of [
      ['c1', 1],
      ['c2', 2],
    ] as const) {
      const campus = await one('insert into campuses (org_id, name) values ($1, $2)', [
        ctx.orgId,
        key,
      ]);
      fx[key] = campus;
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, `數學 ${key}`, subject],
      );
      const klass = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, course, `班 ${key}`],
      );
      for (let i = 0; i < n; i += 1) {
        const student = await one(
          "insert into students (org_id, name, grade) values ($1, $2, 'J2') ",
          [ctx.orgId, `${key}-${i}`],
        );
        const enrollment = await one(
          `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
           values ($1, $2, $3, 'active', 'period', 1000, '2026-01-01')`,
          [ctx.orgId, klass, student],
        );
        enrollIds[key]!.push(enrollment);
      }
    }
    // C2 的人在 P2 已開單；C1 的人 P2 還沒
    const c2Student = (
      await q<{ student_id: string }>('select student_id from enrollments where id = $1', [
        enrollIds['c2']![0],
      ])
    )[0]!.student_id;
    const invoice = await one(
      'insert into invoices (org_id, student_id, issued_at, due_date, created_by) values ($1, $2, current_date, current_date + 14, $3)',
      [ctx.orgId, c2Student, ctx.userId],
    );
    await q(
      `insert into invoice_items (invoice_id, type, enrollment_id, amount, billing_period_id)
       values ($1, 'tuition', $2, 1000, $3)`,
      [invoice, enrollIds['c2']![0], fx.p2],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from invoice_items where invoice_id in (select id from invoices where org_id = $1)',
      'delete from invoices where org_id = $1',
      'delete from billing_periods where org_id = $1',
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

  type Scope = 'all' | 'c1' | 'none';
  type Row = { periodId: string; pendingEnrollmentCount: number };
  const get = async (scope: Scope, query = '') => {
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx.c1] : [];
    try {
      const res = await app.request(`/api/billing-periods/upcoming-unbilled${query}`, {}, env);
      const body = res.status === 200 ? ((await res.json()) as { data: Row[] }) : null;
      return {
        status: res.status,
        rows: body?.data.map((r) => [r.periodId, r.pendingEnrollmentCount]),
      };
    } finally {
      ctx.campusScope = null;
    }
  };

  it('不受限：P1 全機構 3 人；P2 已有人開過單 → 不列（防過度擋的正控）', async () => {
    expect(await get('all')).toEqual({ status: 200, rows: [[fx.p1, 3]] });
  });

  it('受限 C1：只算 C1 的 1 人；B 校（C2）開過單不會讓 C1 的 P2 待辦消失', async () => {
    expect(await get('c1')).toEqual({
      status: 200,
      rows: [
        [fx.p1, 1],
        [fx.p2, 1],
      ],
    });
  });

  it('空範圍：什麼都沒有（不是全機構）', async () => {
    expect(await get('none')).toEqual({ status: 200, rows: [] });
  });

  it('受限 C1 指名範圍外的 C2：403；不受限指名 C2 → 只算 C2 的 2 人', async () => {
    expect((await get('c1', `?campusId=${fx.c2}`)).status).toBe(403);
    expect(await get('all', `?campusId=${fx.c2}`)).toEqual({
      status: 200,
      rows: [[fx.p1, 2]],
    });
  });
});
