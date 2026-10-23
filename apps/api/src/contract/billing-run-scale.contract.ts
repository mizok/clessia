import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **帳務作業在大校規模下不重複開帳、不改錯餐費**（#1934），對真的本機 PostgREST＋Postgres 跑。
 *
 * 原本的兩條會動到錢的路，都只在規模夠大時才出現，替身量不到：
 * - 學費冪等查詢把**所有** active 報名的 id 塞進 `.in()` → 上千個就 414 → 錯誤被吞 → 整批再開一次
 * - 餐費蓋章總額把每一列餐記錄撈回來加 → 超過 1000 列被 `max_rows` 截斷 → 總額少算 → 判成異常、repair 改低
 *
 * 這支自建一個 org：1100 筆月繳報名、80 個學生各訂 20 天餐（1600 列）。同一個月跑兩次 run，
 * 第二次要**一張都不開**；開完帳後的異常掃描要**零筆**、repair 要**一筆都不改**。測完整個 org 刪掉。
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

const ctx: { orgId: string; userId: string; campusScope: string[] | null } = {
  orgId: '',
  userId: '',
  campusScope: null,
};

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
      set('auth', { pool: { query: pool!.query.bind(pool), end: async () => undefined } });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

const ENROLLMENTS = 1100;
// 80 × 20 = 1600 列：每一段（待開餐費、蓋章總額）都要超過 1000 才量得到截斷。
// 60 人（1200 列）時舊程式只開出 50 筆 item，蓋章剛好 1000 列、不被截斷 —— 那個 fixture 驗不到第二個 bug
const MEAL_STUDENTS = 80;
const MEAL_DAYS = 20;

interface RunBody {
  invoicesCreated: number;
  tuitionItems: number;
  mealItems: number;
  mealRecordsSettled: number;
  anomalies: unknown[];
}

run('帳務作業在大校規模下（#1934）', () => {
  /** 受限者那段用：主分校、第二分校、只在第二分校報名的學生、主分校的對照學生 */
  const scoped = { campus: '', otherCampus: '', outsider: '', insider: '' };
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#1934 契約：大校') returning id",
      )
    )[0]!.id;
    const [campus] = await q<{ id: string }>(
      "insert into campuses (org_id, name) values ($1, '大校') returning id",
      [ctx.orgId],
    );
    const [subject] = await q<{ id: string }>(
      "insert into subjects (org_id, name) values ($1, '數學') returning id",
      [ctx.orgId],
    );
    const [course] = await q<{ id: string }>(
      "insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, '數學', $3) returning id",
      [ctx.orgId, campus!.id, subject!.id],
    );
    const [klass] = await q<{ id: string }>(
      "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '大班') returning id",
      [ctx.orgId, campus!.id, course!.id],
    );
    await q(
      `with s as (
         insert into students (org_id, name, grade)
         select $1, '學生' || g, 'J1' from generate_series(1, $3::int) g
         returning id
       )
       insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       select $1, $2, s.id, 'active', 'monthly', 1000, '2026-01-01' from s`,
      [ctx.orgId, klass!.id, ENROLLMENTS],
    );
    await q(
      `insert into meal_records (org_id, student_id, meal_date, ordered, chargeable, unit_price)
       select $1, s.id, date '2026-03-01' + d, true, true, 65
         from (select id from students where org_id = $1 order by id limit $2::int) s
         cross join generate_series(0, $3::int - 1) d`,
      [ctx.orgId, MEAL_STUDENTS, MEAL_DAYS],
    );
    // 受限者那段（4 月）：第二間分校的班＋一個只在那裡報名、也訂了餐的學生（期繳，月 run 不開他的學費）
    scoped.campus = campus!.id;
    const [otherCampus] = await q<{ id: string }>(
      "insert into campuses (org_id, name) values ($1, '第二分校') returning id",
      [ctx.orgId],
    );
    scoped.otherCampus = otherCampus!.id;
    const [otherClass] = await q<{ id: string }>(
      "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '第二分校的班') returning id",
      [ctx.orgId, otherCampus!.id, course!.id],
    );
    const [outsider] = await q<{ id: string }>(
      "insert into students (org_id, name, grade) values ($1, '只在第二分校', 'J1') returning id",
      [ctx.orgId],
    );
    scoped.outsider = outsider!.id;
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       values ($1, $2, $3, 'active', 'period', 1000, '2026-01-01')`,
      [ctx.orgId, otherClass!.id, outsider!.id],
    );
    const [insider] = await q<{ id: string }>(
      'select id from students where org_id = $1 and id <> $2 order by id limit 1',
      [ctx.orgId, outsider!.id],
    );
    scoped.insider = insider!.id;
    await q(
      `insert into meal_records (org_id, student_id, meal_date, ordered, chargeable, unit_price)
       select $1, s, date '2026-04-01' + d, true, true, 65
         from unnest(array[$2::uuid, $3::uuid]) s cross join generate_series(0, 4) d`,
      [ctx.orgId, outsider!.id, insider!.id],
    );

    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    await q('delete from meal_records where org_id = $1', [ctx.orgId]);
    // 明細跟著帳單級聯刪：作廢單的明細不能直接 DELETE（invoice_items_guard_voided），級聯時放行
    await q('delete from payment_records where org_id = $1', [ctx.orgId]);
    await q('delete from invoices where org_id = $1', [ctx.orgId]);
    await q('delete from enrollments where org_id = $1', [ctx.orgId]);
    await q('delete from students where org_id = $1', [ctx.orgId]);
    await q('delete from audit_logs where org_id = $1', [ctx.orgId]);
    await q('delete from organizations where id = $1', [ctx.orgId]);
  }, 120_000);

  const runMonth = async (periodMonth = '2026-03') => {
    const res = await app.request(
      '/api/billing-runs',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ periodMonth }),
      },
      env,
    );
    return { status: res.status, body: (await res.json()) as RunBody };
  };

  it('同一個月跑兩次：第一次開 1100 張，第二次一張都不開（學費冪等不受 id 數量與 1000 列影響）', async () => {
    const first = await runMonth();
    expect(first.status).toBe(200);
    expect(first.body.invoicesCreated).toBe(ENROLLMENTS);
    expect(first.body.tuitionItems).toBe(ENROLLMENTS);
    expect(first.body.mealItems).toBe(MEAL_STUDENTS);
    expect(first.body.mealRecordsSettled).toBe(MEAL_STUDENTS * MEAL_DAYS);
    // 1600 列蓋章、80 筆 item：總額在 SQL 裡加，不會被截成「對不上」
    expect(first.body.anomalies).toEqual([]);

    const second = await runMonth();
    expect(second.status).toBe(200);
    expect(second.body.invoicesCreated).toBe(0);
    expect(second.body.tuitionItems).toBe(0);

    const [{ n }] = await q<{ n: string }>(
      `select count(*) as n from invoice_items ii join invoices i on i.id = ii.invoice_id
          where i.org_id = $1 and ii.type = 'tuition'`,
      [ctx.orgId],
    );
    expect(Number(n)).toBe(ENROLLMENTS);
  }, 300_000);

  it('異常掃描零筆、repair 一筆都不改（每筆餐費 item ＝ 20 天 × 65 元）', async () => {
    const anomalies = await app.request('/api/billing-runs/anomalies', {}, env);
    expect(anomalies.status).toBe(200);
    expect(((await anomalies.json()) as { data: unknown[] }).data).toEqual([]);

    const repair = await app.request('/api/billing-runs/repair', { method: 'POST' }, env);
    expect(repair.status).toBe(200);
    expect(((await repair.json()) as { repaired: number }).repaired).toBe(0);

    const amounts = await q<{ amount: string }>(
      `select distinct ii.amount::text as amount from invoice_items ii join invoices i on i.id = ii.invoice_id
        where i.org_id = $1 and ii.type = 'meal'`,
      [ctx.orgId],
    );
    expect(amounts.map((a) => Number(a.amount))).toEqual([MEAL_DAYS * 65]);
  });

  // #898 裁決 B：作廢單上的學費不算開過 —— pg 路徑靠 alreadyBilledViaSql 的 `i.voided_at is null`。
  // 拿掉的話，作廢過的月份永遠開不出來，而替身走 REST、量不到（二讀 @9f9afd17）
  it('作廢其中一張（只有學費的）再跑同一個月 → 剛好重開那一張', async () => {
    const [target] = await q<{ id: string }>(
      `select i.id from invoices i
        where i.org_id = $1 and i.voided_at is null
          and not exists (select 1 from invoice_items ii where ii.invoice_id = i.id and ii.type = 'meal')
        order by i.id limit 1`,
      [ctx.orgId],
    );
    await q(
      "update invoices set voided_at = now(), void_reason = '#1934 契約：作廢後重開' where id = $1",
      [target!.id],
    );

    const again = await runMonth();
    expect(again.status).toBe(200);
    expect(again.body.invoicesCreated).toBe(1);
    expect(again.body.tuitionItems).toBe(1);
  }, 300_000);

  // 受限者只開範圍內學生的餐費 —— pg 路徑靠 mealStudentsInScopeViaSql（金額路徑上的授權面）
  it('受限者（只有主分校）跑 4 月：只在第二分校報名的學生不被開餐費，主分校的對照學生照開', async () => {
    ctx.campusScope = [scoped.campus];
    try {
      const april = await runMonth('2026-04');
      expect(april.status).toBe(200);
      expect(april.body.mealItems).toBe(1);
      expect(april.body.mealRecordsSettled).toBe(5);
    } finally {
      ctx.campusScope = null;
    }
    const unstamped = await q<{ student_id: string; n: string }>(
      `select student_id, count(*) filter (where invoice_item_id is null) as n
         from meal_records where org_id = $1 and meal_date >= '2026-04-01'
        group by student_id order by student_id`,
      [ctx.orgId],
    );
    expect(Object.fromEntries(unstamped.map((r) => [r.student_id, Number(r.n)]))).toEqual({
      [scoped.outsider]: 5,
      [scoped.insider]: 0,
    });
  }, 300_000);

  // 使用者 10-23 裁定（#1936）：帳單已經有收款的，repair 只列出、不改金額。
  // 「有收款」＝淨收款（收款 − 退費）≠ 0，部分繳也算；退到 0 的視同沒收過，照修
  it('repair 跳過已有收款的帳單：繳清、部分繳都只列出不改；退款退到 0 的照修', async () => {
    const items = await q<{ id: string; invoice_id: string; amount: string }>(
      `select ii.id, ii.invoice_id, ii.amount::text as amount
         from invoice_items ii join invoices i on i.id = ii.invoice_id
        where i.org_id = $1 and ii.type = 'meal' and ii.period_month = '2026-03-01'
        order by ii.id limit 4`,
      [ctx.orgId],
    );
    const [unpaid, paid, partial, refunded] = items;
    const pay = (invoiceId: string, kind: 'payment' | 'refund', amount: number) =>
      q(
        `insert into payment_records (org_id, invoice_id, kind, amount, method)
         values ($1, $2, $3, $4, 'cash')`,
        [ctx.orgId, invoiceId, kind, amount],
      );
    await pay(paid!.invoice_id, 'payment', 999_999);
    await pay(partial!.invoice_id, 'payment', 100);
    await pay(refunded!.invoice_id, 'payment', 100);
    await pay(refunded!.invoice_id, 'refund', 100);
    // 四筆都弄成對不上（多 10 元）
    await q('update invoice_items set amount = amount + 10 where id = any($1::uuid[])', [
      items.map((i) => i.id),
    ]);

    const res = await app.request('/api/billing-runs/repair', { method: 'POST' }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      repaired: number;
      skippedPaid: number;
      remaining: Array<{ invoiceItemId: string }>;
    };
    expect(body.repaired).toBe(2);
    expect(body.skippedPaid).toBe(2);
    expect(body.remaining.map((r) => r.invoiceItemId).sort()).toEqual(
      [paid!.id, partial!.id].sort(),
    );

    const after = new Map(
      (
        await q<{ id: string; amount: string }>(
          'select id, amount::text as amount from invoice_items where id = any($1::uuid[])',
          [items.map((i) => i.id)],
        )
      ).map((r) => [r.id, Number(r.amount)]),
    );
    expect(after.get(unpaid!.id)).toBe(Number(unpaid!.amount)); // 修回去
    expect(after.get(refunded!.id)).toBe(Number(refunded!.amount)); // 淨 0 → 修回去
    expect(after.get(paid!.id)).toBe(Number(paid!.amount) + 10); // 沒動
    expect(after.get(partial!.id)).toBe(Number(partial!.amount) + 10); // 沒動
  }, 120_000);
});
