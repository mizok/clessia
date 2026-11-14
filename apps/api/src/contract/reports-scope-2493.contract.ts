// scope-contract: GET /api/reports/revenue
// scope-contract: GET /api/reports/revenue.csv
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493 R8：營收報表看帳單學生的分校範圍**（保留類：授權範圍＋金額），對真的本機 PostgREST＋Postgres 跑。
 *
 * `matchesFilter` 原本只排除「有班的明細沾到範圍外」的帳單；只有餐費／調整（沒有班）的帳單 contexts 為空，
 * 直接通過 —— 別校學生的餐費收款與應收算進受限管理員的營收（歸在「未分類」）。
 * 修法：補 invoices.ts 判準的第 1 條「帳單學生在範圍內」（studentInScope）。**只縮範圍、不動金額計算**：
 * 不受限者的數字不變。巢狀 `invoices!inner(... scope_student:students(...))` 的 alias 要在真 PostgREST 量。
 *
 * fixture：sA 報 C1 的 A 班、sX 報 C2 的 X 班。invA：sA 的學費 1000（收 1000）；invX：sX 只有餐費 500（收 500）。
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

run('#2493 營收報表看帳單學生的分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：營收範圍')", []);
    fx.c1 = await one("insert into campuses (org_id, name) values ($1, 'C1')", [ctx.orgId]);
    const c2 = await one("insert into campuses (org_id, name) values ($1, 'C2')", [ctx.orgId]);
    const subject = await one("insert into subjects (org_id, name) values ($1, '英文')", [
      ctx.orgId,
    ]);
    const student = async (campus: string, name: string) => {
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, `英文 ${name}`, subject],
      );
      const klass = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, course, `班 ${name}`],
      );
      const id = await one("insert into students (org_id, name, grade) values ($1, $2, 'J2')", [
        ctx.orgId,
        name,
      ]);
      const enrollment = await one(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
        [ctx.orgId, klass, id],
      );
      return { id, enrollment };
    };
    const sA = await student(fx.c1, '甲');
    const sX = await student(c2, '乙');
    const invoice = async (
      studentId: string,
      item: { type: string; enrollment: string | null; amount: number },
    ) => {
      const inv = await one(
        "insert into invoices (org_id, student_id, issued_at, due_date) values ($1, $2, '2026-10-01', '2026-10-31')",
        [ctx.orgId, studentId],
      );
      await q(
        'insert into invoice_items (invoice_id, type, enrollment_id, amount) values ($1, $2, $3, $4)',
        [inv, item.type, item.enrollment, item.amount],
      );
      await q(
        `insert into payment_records (org_id, invoice_id, kind, amount, method, paid_at)
         values ($1, $2, 'payment', $3, 'cash', '2026-10-05')`,
        [ctx.orgId, inv, item.amount],
      );
    };
    await invoice(sA.id, { type: 'tuition', enrollment: sA.enrollment, amount: 1000 });
    await invoice(sX.id, { type: 'meal', enrollment: null, amount: 500 });
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from invoices where org_id = $1',
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
  const get = async (scope: Scope, path: string) => {
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx.c1] : [];
    try {
      return await app.request(
        `/api/reports${path}?dateFrom=2026-10-01&dateTo=2026-10-31`,
        {},
        env,
      );
    } finally {
      ctx.campusScope = null;
    }
  };
  type Figures = { received: number; billed: number };
  const summary = async (scope: Scope) =>
    ((await (await get(scope, '/revenue')).json()) as { summary: Figures }).summary;

  it('/revenue：受限 C1 的實收與應收只算 sA（別校學生只有餐費的帳單不算）；空範圍 0；不受限照舊兩張', async () => {
    expect(await summary('c1')).toMatchObject({ received: 1000, billed: 1000 });
    expect(await summary('none')).toMatchObject({ received: 0, billed: 0 });
    expect(await summary('all')).toMatchObject({ received: 1500, billed: 1500 });
  });

  it('/revenue.csv：受限 C1 只有 sA 那筆收款；不受限兩筆', async () => {
    const lines = async (scope: Scope) =>
      (await (await get(scope, '/revenue.csv')).text()).trim().split('\n').length - 1;
    expect(await lines('c1')).toBe(1);
    expect(await lines('all')).toBe(2);
  });
});
