// scope-contract: GET /api/billing-runs/anomalies
// scope-contract: POST /api/billing-runs
// scope-contract: POST /api/billing-runs/repair
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **帳務作業每位學生一筆交易**（#1943），對真的本機 Postgres 跑。
 *
 * 原本每位學生依序打幾支 supabase-js 寫入、錯誤幾乎沒檢查：學費明細寫失敗就留下空帳單，回應照樣成功。
 * 這支自建一個 org、100 位學生（月繳＋訂餐），驗：
 * - 一位學生的學費明細寫入失敗（測試用 trigger 注入）→ **他沒有帳單、餐也沒被蓋章**，其他 99 位照開，
 *   回應 200 並在 `failedStudents` 列出他的名字；拿掉 trigger 再跑一次 → 剛好補開他那一張
 * - 同一個月**同時**按兩次 run → 每筆報名只開一次、不留空帳單
 * 測完 trigger 與整個 org 都刪掉。
 */

/**
 * **#2493：帳務作業（開帳、異常掃描、修補）只動受限者自己分校的**（保留類：金額、授權範圍），
 * 對真的本機 PostgREST＋Postgres 跑。
 *
 * 學費只挑班在範圍內的報名；餐費沒有分校，挑任一報名在範圍內的學生；異常掃描與 repair 只看、只修範圍內的帳單。
 * 條件沒下的後果是別校的學生被開帳、別校的金額被改，而且不報錯。
 *
 * fixture：C1 有學生甲（月繳 1000）、C2 有學生乙（月繳 2000），各有 3 月的餐記錄；4 月各有一張
 * 金額對不上蓋章的餐費帳單（異常）；另各有一筆沒有計費模式的報名。管理員只被指派 C1。
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
      // 開帳寫入走 withTx（#1943），要 connect
      set('auth', {
        pool: {
          query: pool!.query.bind(pool),
          connect: pool!.connect.bind(pool),
          end: async () => undefined,
        },
      });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

type Scope = 'all' | 'c1' | 'none';
interface Anomaly {
  invoiceItemId: string;
  itemAmount: number;
  expectedAmount: number;
}

run('帳務作業看分校範圍（#2493）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = {
    c1: '',
    c2: '',
    sA: '',
    sX: '',
    nA: '',
    nX: '',
    itemA: '',
    itemX: '',
  };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：帳務範圍')", []);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    const klass: Record<string, string> = {};
    for (const key of ['c1', 'c2'] as const) {
      fx[key] = await one('insert into campuses (org_id, name) values ($1, $2)', [ctx.orgId, key]);
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, fx[key], `數學 ${key}`, subject],
      );
      klass[key] = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, fx[key], course, `班 ${key}`],
      );
    }
    const student = (name: string) =>
      one("insert into students (org_id, name, grade) values ($1, $2, 'J2')", [ctx.orgId, name]);
    const enroll = (cls: string, studentId: string, mode: string | null, amount: number) =>
      q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', $4, $5, '2026-01-01')`,
        [ctx.orgId, cls, studentId, mode, amount],
      );
    fx.sA = await student('甲');
    fx.sX = await student('乙');
    fx.nA = await student('甲無模式');
    fx.nX = await student('乙無模式');
    await enroll(klass['c1']!, fx.sA, 'monthly', 1000);
    await enroll(klass['c2']!, fx.sX, 'monthly', 2000);
    await enroll(klass['c1']!, fx.nA, null, 1000);
    await enroll(klass['c2']!, fx.nX, null, 1000);
    // 3 月餐（run 要開的）
    await q(
      `insert into meal_records (org_id, student_id, meal_date, ordered, chargeable, unit_price)
       select $1, s, date '2026-03-02' + d, true, true, 65
         from unnest($2::uuid[]) s cross join generate_series(0, 1) d`,
      [ctx.orgId, [fx.sA, fx.sX]],
    );
    // 4 月：已開的餐費帳單，金額 999 對不上蓋章 130（異常）
    for (const [key, studentId] of [
      ['itemA', fx.sA],
      ['itemX', fx.sX],
    ] as const) {
      const invoice = await one(
        `insert into invoices (org_id, student_id, issued_at, due_date, created_by)
         values ($1, $2, '2026-04-01', '2026-04-15', $3)`,
        [ctx.orgId, studentId, ctx.userId],
      );
      fx[key] = await one(
        `insert into invoice_items (invoice_id, type, amount, period_month)
         values ($1, 'meal', 999, '2026-04-01')`,
        [invoice],
      );
      await q(
        `insert into meal_records (org_id, student_id, meal_date, ordered, chargeable, unit_price, invoice_item_id)
         select $1, $2, date '2026-04-01' + d, true, true, 65, $3 from generate_series(0, 1) d`,
        [ctx.orgId, studentId, fx[key]],
      );
    }
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'update meal_records set invoice_item_id = null where org_id = $1',
      'delete from invoice_items where invoice_id in (select id from invoices where org_id = $1)',
      'delete from invoices where org_id = $1',
      'delete from meal_records where org_id = $1',
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

  const call = async (scope: Scope, method: string, path: string, body?: unknown) => {
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx.c1] : [];
    try {
      const res = await app.request(
        `/api/billing-runs${path}`,
        {
          method,
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        env,
      );
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    } finally {
      ctx.campusScope = null;
    }
  };
  const amount = async (itemId: string) =>
    Number(
      (await q<{ amount: string }>('select amount from invoice_items where id = $1', [itemId]))[0]!
        .amount,
    );
  /** 這位學生 3 月開了幾筆學費／餐費明細 */
  const march = async (studentId: string) =>
    (
      await q<{ type: string; n: number }>(
        `select ii.type, count(*)::int n from invoice_items ii join invoices i on i.id = ii.invoice_id
          where i.student_id = $1 and ii.period_month = '2026-03-01' group by ii.type order by ii.type`,
        [studentId],
      )
    )
      .map((r) => `${r.type}:${r.n}`)
      .sort();
  const stamped = async (studentId: string) =>
    (
      await q<{ n: number }>(
        `select count(*)::int n from meal_records
          where student_id = $1 and meal_date < '2026-04-01' and invoice_item_id is not null`,
        [studentId],
      )
    )[0]!.n;

  it('GET anomalies：受限 C1 只看到甲的異常與甲的無模式報名；空範圍都沒有；不受限看全部', async () => {
    const c1 = await call('c1', 'GET', '/anomalies');
    expect(c1.status).toBe(200);
    expect((c1.body['data'] as Anomaly[]).map((a) => a.invoiceItemId)).toEqual([fx.itemA]);
    expect(
      (c1.body['enrollmentsWithoutBillingMode'] as Array<{ studentId: string }>).map(
        (e) => e.studentId,
      ),
    ).toEqual([fx.nA]);
    const none = await call('none', 'GET', '/anomalies');
    expect(none.body['data']).toEqual([]);
    expect(none.body['enrollmentsWithoutBillingMode']).toEqual([]);
    const all = await call('all', 'GET', '/anomalies');
    expect((all.body['data'] as Anomaly[]).map((a) => a.invoiceItemId).sort()).toEqual(
      [fx.itemA, fx.itemX].sort(),
    );
    expect(all.body['enrollmentsWithoutBillingMode']).toHaveLength(2);
  });

  it('POST repair：受限 C1 只修甲、乙那張金額沒動；空範圍什麼都不修；不受限修掉乙（正控）', async () => {
    const c1 = await call('c1', 'POST', '/repair');
    expect(c1.status).toBe(200);
    expect(c1.body['repaired']).toBe(1);
    expect(await amount(fx.itemA)).toBe(130);
    expect(await amount(fx.itemX)).toBe(999);
    const none = await call('none', 'POST', '/repair');
    expect(none.body['repaired']).toBe(0);
    expect(await amount(fx.itemX)).toBe(999);
    const all = await call('all', 'POST', '/repair');
    expect(all.body['repaired']).toBe(1);
    expect(await amount(fx.itemX)).toBe(130);
  });

  it('POST run：受限 C1 只開甲（學費＋餐費）；乙沒被開、餐記錄沒被蓋章', async () => {
    const r = await call('c1', 'POST', '', { periodMonth: '2026-03' });
    expect(r.status).toBe(200);
    expect(r.body['invoicesCreated']).toBe(1);
    expect(await march(fx.sA)).toEqual(['meal:1', 'tuition:1']);
    expect(await march(fx.sX)).toEqual([]);
    expect(await stamped(fx.sX)).toBe(0);
  });

  it('POST run：空範圍什麼都不開', async () => {
    const r = await call('none', 'POST', '', { periodMonth: '2026-03' });
    expect(r.status).toBe(200);
    expect(r.body['invoicesCreated']).toBe(0);
    expect(await march(fx.sX)).toEqual([]);
  });

  it('POST run：不受限補開乙；甲不重複開（防過度擋、冪等）', async () => {
    const r = await call('all', 'POST', '', { periodMonth: '2026-03' });
    expect(r.status).toBe(200);
    expect(r.body['invoicesCreated']).toBe(1);
    expect(await march(fx.sX)).toEqual(['meal:1', 'tuition:1']);
    expect(await march(fx.sA)).toEqual(['meal:1', 'tuition:1']);
    expect(await stamped(fx.sX)).toBe(2);
  });
});
