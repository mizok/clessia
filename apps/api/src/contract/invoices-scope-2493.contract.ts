// scope-contract: GET /api/invoices
// scope-contract: GET /api/invoices/summary
// scope-contract: GET /api/invoices/:id
// scope-contract: POST /api/invoices
// scope-contract: POST /api/invoices/:id/items
// scope-contract: DELETE /api/invoices/:id/items/:itemId
// scope-contract: POST /api/invoices/:id/payments
// scope-contract: POST /api/invoices/:id/void
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493 上半：帳單 8 支舊端點的分校範圍契約認領**（保留類：授權範圍＋金額），對真的本機 PostgREST＋Postgres 跑。
 * 盤點時範圍已 OK（`findScopedInvoice`／`invoiceInScope`：學生與明細的班都要在範圍內），這裡把它釘住。
 *
 * fixture：C1、C2；只在 C2 報名的學生一張帳單（C2 學費 1000）。管理員只被指派 C1。
 * 受限 C1：列表、彙總看不到那張；單筆讀、加明細、刪明細、收款、作廢一律 404（以 id 指名的單筆不透露存在）、
 * 什麼都沒寫；替 C2 的學生開單 404、沒開出來。不受限同樣的請求照常。
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

run('#2493 帳單舊端點看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '', c2: '', s2: '', e2: '', inv: '', item: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：帳單範圍')", []);
    fx.c1 = await one("insert into campuses (org_id, name) values ($1, 'C1')", [ctx.orgId]);
    fx.c2 = await one("insert into campuses (org_id, name) values ($1, 'C2')", [ctx.orgId]);
    const subject = await one("insert into subjects (org_id, name) values ($1, '數學')", [
      ctx.orgId,
    ]);
    const course = await one(
      'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
      [ctx.orgId, fx.c2, '數學 C2', subject],
    );
    const klass = await one(
      'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
      [ctx.orgId, fx.c2, course, '班 C2'],
    );
    fx.s2 = await one("insert into students (org_id, name, grade) values ($1, '二校生', 'J2')", [
      ctx.orgId,
    ]);
    fx.e2 = await one(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
      [ctx.orgId, klass, fx.s2],
    );
    fx.inv = await one('insert into invoices (org_id, student_id) values ($1, $2)', [
      ctx.orgId,
      fx.s2,
    ]);
    fx.item = await one(
      `insert into invoice_items (invoice_id, type, enrollment_id, amount, period_month)
       values ($1, 'tuition', $2, 1000, '2026-01-01')`,
      [fx.inv, fx.e2],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from payment_records where invoice_id in (select id from invoices where org_id = $1)',
      'delete from invoice_items where invoice_id in (select id from invoices where org_id = $1)',
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

  const call = async (scope: 'all' | 'c1', method: string, path: string, body?: unknown) => {
    ctx.campusScope = scope === 'all' ? null : [fx.c1];
    try {
      return await app.request(
        `/api/invoices${path}`,
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
  const snapshot = async () =>
    JSON.stringify(
      await q(
        `select i.voided_at,
                (select count(*)::int from invoice_items x where x.invoice_id = i.id) items,
                (select count(*)::int from payment_records p where p.invoice_id = i.id) payments
           from invoices i where i.id = $1`,
        [fx.inv],
      ),
    );
  const invoiceCount = async () =>
    (
      await q<{ n: number }>('select count(*)::int n from invoices where org_id = $1', [ctx.orgId])
    )[0]!.n;

  const WRITES = (itemId: string): Array<[string, string, unknown]> => [
    ['POST', `/${fx.inv}/items`, { type: 'meal', amount: 500 }],
    ['POST', `/${fx.inv}/payments`, { amount: 100, method: 'cash' }],
    ['DELETE', `/${fx.inv}/items/${itemId}`, undefined],
    ['POST', `/${fx.inv}/void`, { reason: '契約作廢' }],
  ];

  it('GET /、GET /summary：受限 C1 看不到二校生的帳單、彙總沒算它；不受限有', async () => {
    const listed = async (scope: 'all' | 'c1') =>
      ((await (await call(scope, 'GET', '')).json()) as { data: { id: string }[] }).data.some(
        (r) => r.id === fx.inv,
      );
    expect(await listed('c1')).toBe(false);
    expect(await listed('all')).toBe(true);
    const billed = async (scope: 'all' | 'c1') => {
      const res = await call(scope, 'GET', '/summary');
      expect(res.status).toBe(200);
      return ((await res.json()) as { month: { billed: number } }).month.billed;
    };
    expect(await billed('c1')).toBe(0);
    expect(await billed('all')).toBe(1000);
  });

  it('GET /:id 與四支寫入：受限 C1 → 404、帳單一筆都沒動；替二校生開單 404、沒開出來', async () => {
    const before = await snapshot();
    const read = await call('c1', 'GET', `/${fx.inv}`);
    expect(read.status).toBe(404);
    expect(JSON.stringify(await read.json())).not.toContain('二校生');
    for (const [method, path, body] of WRITES(fx.item)) {
      expect(`${method} ${path} → ${(await call('c1', method, path, body)).status}`).toBe(
        `${method} ${path} → 404`,
      );
    }
    expect(await snapshot()).toBe(before);

    const count = await invoiceCount();
    // 只帶餐費：不經「明細的報名在範圍外」那道，擋下它的是學生本身的範圍
    const created = await call('c1', 'POST', '', {
      studentId: fx.s2,
      items: [{ type: 'meal', amount: 500 }],
    });
    expect(created.status).toBe(404);
    expect(await created.json()).toMatchObject({ code: 'STUDENT_NOT_FOUND' });
    expect(await invoiceCount()).toBe(count);
  });

  it('不受限：單筆讀、開單、加明細、收款、刪明細、作廢照常', async () => {
    expect((await call('all', 'GET', `/${fx.inv}`)).status).toBe(200);
    const count = await invoiceCount();
    const created = await call('all', 'POST', '', {
      studentId: fx.s2,
      items: [{ type: 'tuition', enrollmentId: fx.e2, amount: 1000, periodMonth: '2026-02-01' }],
    });
    expect(created.status).toBe(201);
    const fresh = ((await created.json()) as { data: { id: string } }).data.id;
    expect(await invoiceCount()).toBe(count + 1);
    const added = await call('all', 'POST', `/${fx.inv}/items`, { type: 'meal', amount: 500 });
    expect(added.status).toBe(201);
    const { data } = (await added.json()) as { data: { items: { id: string; type: string }[] } };
    const meal = data.items.find((i) => i.type === 'meal')!.id;
    const [, pay, del] = WRITES(meal);
    expect((await call('all', pay![0], pay![1], pay![2])).status).toBe(201);
    expect((await call('all', del![0], del![1], del![2])).status).toBe(200);
    // 有收款的單不能作廢（ALREADY_PAID 類 409）：作廢剛開的那張
    expect((await call('all', 'POST', `/${fresh}/void`, { reason: '契約作廢' })).status).toBe(200);
  });
});
