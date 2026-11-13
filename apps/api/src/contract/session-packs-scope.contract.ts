// scope-contract: GET /api/session-packs
// scope-contract: POST /api/session-packs
// scope-contract: DELETE /api/session-packs/:id
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **堂數帳三支端點套分校範圍**（#2147，保留類：授權面），對真的本機 PostgREST 跑 ——
 * 範圍判準是「這筆報名的班在範圍內」（同報名列表，`classes!inner` 依分校篩），要 embed，替身量不到。
 *
 * 自建一個 org：兩個分校各一個班，一位學生兩邊都報（e1 在 C1、e2 在 C2），兩筆報名各有一包堂數。
 * 受限 C1 的管理員：讀不到 e2、替 e2 加不了、刪不了 e2 的那包（都是 404，跟不存在同一個回應）；
 * 空範圍什麼都碰不到；不受限的管理員照舊，而且 e1 的回應跟受限 C1 看到的一模一樣（只縮範圍、不動金額計算）。
 * **#2493 W6**：買一包時帶的 `invoiceItemId` 原本連 org 都沒驗 —— 掛到別校（或別 org）帳單的明細上，
 * 那張帳單就作廢不了（`HAS_SESSION_PACK`）。現在必須是同 org、同一筆報名的明細，否則 404 不寫入。
 * 測完整個 org 刪掉。
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
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

run('堂數帳的分校範圍（#2147）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  // i1／i2：e1／e2 各自的 session_pack 帳單明細（#2493 W6）
  // iOther：別 org 帳單上、掛別 org 報名的明細；iForged：別 org 帳單上、enrollment_id 卻指著 e1 的明細
  //（FK 不看 org，所以造得出來）—— 只有 org 條件擋得住它，審核席 M3 拿掉 org 條件時要紅
  const fx = {
    c1: '',
    c2: '',
    e1: '',
    e2: '',
    p1: '',
    p2: '',
    i1: '',
    i2: '',
    iOther: '',
    iForged: '',
  };
  let otherOrgId = '';

  const itemFor = async (orgId: string, studentId: string, enrollmentId: string | null) => {
    const [invoice] = await q<{ id: string }>(
      "insert into invoices (org_id, student_id, issued_at) values ($1, $2, '2026-09-01') returning id",
      [orgId, studentId],
    );
    const [item] = await q<{ id: string }>(
      `insert into invoice_items (invoice_id, type, enrollment_id, amount)
       values ($1, 'session_pack', $2, 5000) returning id`,
      [invoice!.id, enrollmentId],
    );
    return item!.id;
  };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#2147 契約：堂數帳分校範圍') returning id",
      )
    )[0]!.id;
    const [subject] = await q<{ id: string }>(
      "insert into subjects (org_id, name) values ($1, '數學') returning id",
      [ctx.orgId],
    );
    const [student] = await q<{ id: string }>(
      "insert into students (org_id, name, grade) values ($1, '兩校都有', 'P5') returning id",
      [ctx.orgId],
    );
    for (const key of ['1', '2'] as const) {
      const [campus] = await q<{ id: string }>(
        'insert into campuses (org_id, name) values ($1, $2) returning id',
        [ctx.orgId, `c${key}`],
      );
      fx[`c${key}`] = campus!.id;
      const [course] = await q<{ id: string }>(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4) returning id',
        [ctx.orgId, campus!.id, `數學 c${key}`, subject!.id],
      );
      const [klass] = await q<{ id: string }>(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4) returning id',
        [ctx.orgId, campus!.id, course!.id, `班 c${key}`],
      );
      const [enrollment] = await q<{ id: string }>(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'session_pack', 500, '2026-01-01') returning id`,
        [ctx.orgId, klass!.id, student!.id],
      );
      fx[`e${key}`] = enrollment!.id;
      const [pack] = await q<{ id: string }>(
        `insert into session_packs (org_id, enrollment_id, purchased_count, purchased_at)
         values ($1, $2, 10, '2026-09-01') returning id`,
        [ctx.orgId, enrollment!.id],
      );
      fx[`p${key}`] = pack!.id;
      fx[`i${key}`] = await itemFor(ctx.orgId, student!.id, enrollment!.id);
    }
    otherOrgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#2493 契約：別 org 的帳單') returning id",
      )
    )[0]!.id;
    const [stranger] = await q<{ id: string }>(
      "insert into students (org_id, name, grade) values ($1, '別 org', 'P5') returning id",
      [otherOrgId],
    );
    const [otherCampus] = await q<{ id: string }>(
      "insert into campuses (org_id, name) values ($1, '別 org 校') returning id",
      [otherOrgId],
    );
    const [otherSubject] = await q<{ id: string }>(
      "insert into subjects (org_id, name) values ($1, '數學') returning id",
      [otherOrgId],
    );
    const [otherCourse] = await q<{ id: string }>(
      'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4) returning id',
      [otherOrgId, otherCampus!.id, '別 org 課', otherSubject!.id],
    );
    const [otherClass] = await q<{ id: string }>(
      'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4) returning id',
      [otherOrgId, otherCampus!.id, otherCourse!.id, '別 org 班'],
    );
    const [otherEnrollment] = await q<{ id: string }>(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       values ($1, $2, $3, 'active', 'session_pack', 500, '2026-01-01') returning id`,
      [otherOrgId, otherClass!.id, stranger!.id],
    );
    fx.iOther = await itemFor(otherOrgId, stranger!.id, otherEnrollment!.id);
    fx.iForged = await itemFor(otherOrgId, stranger!.id, fx.e1);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const orgId of [ctx.orgId, otherOrgId].filter(Boolean)) {
      await q('delete from session_packs where org_id = $1', [orgId]);
      await q('delete from invoices where org_id = $1', [orgId]); // 明細 on delete cascade
    }
    if (otherOrgId) {
      for (const table of ['enrollments', 'students', 'classes', 'courses', 'subjects', 'campuses'])
        await q(`delete from ${table} where org_id = $1`, [otherOrgId]);
      await q('delete from organizations where id = $1', [otherOrgId]);
    }
    for (const sql of [
      'delete from session_packs where org_id = $1',
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
  const as = async (scope: Scope, path: string, init: RequestInit = {}) => {
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx.c1] : [];
    try {
      return await app.request(path, init, env);
    } finally {
      ctx.campusScope = null;
    }
  };
  const read = (scope: Scope, enrollmentId: string) =>
    as(scope, `/api/session-packs?enrollmentId=${enrollmentId}`);
  const buy = (scope: Scope, enrollmentId: string) =>
    as(scope, '/api/session-packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrollmentId, purchasedCount: 3, purchasedAt: '2026-09-02' }),
    });
  const packsOf = async (enrollmentId: string) =>
    (
      await q<{ n: string }>('select count(*) as n from session_packs where enrollment_id = $1', [
        enrollmentId,
      ])
    )[0]!.n;

  it('讀：受限 C1 讀得到 C1 的報名、讀不到 C2 的（404）；空範圍都讀不到；不受限的兩筆都讀得到', async () => {
    expect((await read('all', fx.e1)).status).toBe(200);
    expect((await read('all', fx.e2)).status).toBe(200);
    expect((await read('c1', fx.e1)).status).toBe(200);

    const out = await read('c1', fx.e2);
    expect(out.status).toBe(404);
    expect(JSON.stringify(await out.json())).not.toContain(fx.p2);

    expect((await read('none', fx.e1)).status).toBe(404);
  });

  it('讀：範圍內的回應跟不受限的一模一樣（只縮範圍，堂數的計算不變）', async () => {
    const all = await (await read('all', fx.e1)).json();
    const c1 = await (await read('c1', fx.e1)).json();
    expect(c1).toEqual(all);
    expect(all).toMatchObject({ summary: { purchased: 10 } });
  });

  it('加：受限 C1 替 C2 的報名加不了（404、沒有寫入）；空範圍也不行；範圍內與不受限照常', async () => {
    const before = await packsOf(fx.e2);
    expect((await buy('c1', fx.e2)).status).toBe(404);
    expect(await packsOf(fx.e2)).toBe(before);

    const beforeE1 = await packsOf(fx.e1);
    expect((await buy('none', fx.e1)).status).toBe(404);
    expect(await packsOf(fx.e1)).toBe(beforeE1);

    expect((await buy('c1', fx.e1)).status).toBe(201);
    expect((await buy('all', fx.e2)).status).toBe(201);
  });

  it('加（#2493 W6）：invoiceItemId 必須是同 org、同一筆報名的明細，否則 404 且不寫入（含不受限者）', async () => {
    const buyWith = (scope: Scope, enrollmentId: string, invoiceItemId: string) =>
      as(scope, '/api/session-packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId, purchasedCount: 3, invoiceItemId }),
      });
    const linked = async (itemId: string) =>
      (await q('select 1 from session_packs where invoice_item_id = $1', [itemId])).length;

    // 受限 C1：自己的報名掛 C2 帳單的明細 —— 原本會成功，C2 那張帳單從此作廢不了（HAS_SESSION_PACK）
    expect((await buyWith('c1', fx.e1, fx.i2)).status).toBe(404);
    // 不受限也不行：明細屬於別筆報名，掛上去堂數帳就對不到錢
    expect((await buyWith('all', fx.e1, fx.i2)).status).toBe(404);
    // 別 org 帳單、別 org 報名的明細（c1）
    expect((await buyWith('all', fx.e1, fx.iOther)).status).toBe(404);
    // 別 org 帳單、enrollment_id 卻是 e1：報名條件放行，**只剩 org 條件**擋（c1）
    expect((await buyWith('all', fx.e1, fx.iForged)).status).toBe(404);
    expect(await linked(fx.i2)).toBe(0);
    expect(await linked(fx.iOther)).toBe(0);
    expect(await linked(fx.iForged)).toBe(0);

    // 自己那筆報名的明細照常
    const ok = await buyWith('c1', fx.e1, fx.i1);
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ data: { invoiceItemId: fx.i1 } });
  });

  it('刪：受限 C1 刪不了 C2 那包（404、還在）；空範圍也不行；範圍內照常', async () => {
    const del = (scope: Scope, id: string) =>
      as(scope, `/api/session-packs/${id}`, { method: 'DELETE' });
    const exists = async (id: string) =>
      (await q('select 1 from session_packs where id = $1', [id])).length === 1;

    expect((await del('c1', fx.p2)).status).toBe(404);
    expect(await exists(fx.p2)).toBe(true);

    expect((await del('none', fx.p1)).status).toBe(404);
    expect(await exists(fx.p1)).toBe(true);

    expect((await del('c1', fx.p1)).status).toBe(200);
    expect(await exists(fx.p1)).toBe(false);
    expect((await del('all', fx.p2)).status).toBe(200);
  });
});
