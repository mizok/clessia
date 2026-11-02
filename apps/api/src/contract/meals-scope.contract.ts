import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **餐費兩支端點套分校範圍**（#2138，保留類：授權面），對真的本機 PostgREST 跑 ——
 * 範圍判準是「學生任一報名的班在範圍內」，要 embed `enrollments(classes(campus_id))`，替身量不到。
 *
 * 自建一個 org：兩個分校各一個班，那天兩班都有課；a 只在 C1、b 只在 C2、ab 兩邊都有，
 * 三個人那天都有一筆餐費（80 元、要收費）。
 * 受限 C1 的管理員：讀不到 b（區間、單日的名單與記錄、金額摘要都不含 b），寫 b 整批 404 且 b 不變；
 * 空範圍什麼都看不到；不受限的管理員照舊三個都看得到、寫得到。測完整個 org 刪掉。
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

run('餐費的分校範圍（#2138）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const DAY = '2026-09-01';
  const fx = { c1: '', c2: '', a: '', b: '', ab: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#2138 契約：餐費分校範圍') returning id",
      )
    )[0]!.id;
    const [subject] = await q<{ id: string }>(
      "insert into subjects (org_id, name) values ($1, '數學') returning id",
      [ctx.orgId],
    );
    const klass: Record<string, string> = {};
    for (const key of ['c1', 'c2'] as const) {
      const [campus] = await q<{ id: string }>(
        'insert into campuses (org_id, name) values ($1, $2) returning id',
        [ctx.orgId, key],
      );
      fx[key] = campus!.id;
      const [course] = await q<{ id: string }>(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4) returning id',
        [ctx.orgId, campus!.id, `數學 ${key}`, subject!.id],
      );
      const [k] = await q<{ id: string }>(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4) returning id',
        [ctx.orgId, campus!.id, course!.id, `班 ${key}`],
      );
      klass[key] = k!.id;
      // 單日名單的候選＝那天有課的班的在籍學生
      await q(
        `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
         values ($1, $2, $3, '18:00', '19:00', 'scheduled', 'unassigned')`,
        [ctx.orgId, k!.id, DAY],
      );
    }
    const student = async (name: string, classes: string[]) => {
      const [s] = await q<{ id: string }>(
        "insert into students (org_id, name, grade) values ($1, $2, 'P5') returning id",
        [ctx.orgId, name],
      );
      for (const k of classes) {
        await q(
          `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
           values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
          [ctx.orgId, k, s!.id],
        );
      }
      await q(
        `insert into meal_records (org_id, student_id, meal_date, ordered, chargeable, unit_price)
         values ($1, $2, $3, true, true, 80)`,
        [ctx.orgId, s!.id, DAY],
      );
      return s!.id;
    };
    fx.a = await student('只在一校', [klass['c1']!]);
    fx.b = await student('只在二校', [klass['c2']!]);
    fx.ab = await student('兩校都有', [klass['c1']!, klass['c2']!]);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from meal_records where org_id = $1',
      'delete from sessions where org_id = $1',
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
  type Meals = {
    data: Array<{ studentId: string; studentName: string }>;
    meta: { total: number; totalAmount: number };
  };
  const get = async (scope: Scope, path: string) => {
    const res = await as(scope, path);
    expect(res.status).toBe(200);
    return (await res.json()) as Meals;
  };
  const ids = (m: Meals) => new Set(m.data.map((r) => r.studentId));
  const batch = (scope: Scope, studentId: string, unitPrice: number) =>
    as(scope, '/api/meals/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: DAY,
        rows: [{ studentId, ordered: true, chargeable: true, unitPrice }],
      }),
    });
  const priceOf = async (studentId: string) =>
    Number(
      (
        await q<{ unit_price: string }>(
          'select unit_price from meal_records where student_id = $1 and meal_date = $2',
          [studentId, DAY],
        )
      )[0]!.unit_price,
    );

  it('區間查詢：受限 C1 只看得到 C1 學生（含跨校的）的記錄，金額也只算他們', async () => {
    const path = `/api/meals?dateFrom=${DAY}&dateTo=${DAY}`;
    const all = await get('all', path);
    expect(ids(all)).toEqual(new Set([fx.a, fx.b, fx.ab]));
    expect(all.meta).toMatchObject({ total: 3, totalAmount: 240 });

    const c1 = await get('c1', path);
    expect(ids(c1)).toEqual(new Set([fx.a, fx.ab]));
    expect(c1.meta).toMatchObject({ total: 2, totalAmount: 160 });
    expect(JSON.stringify(c1)).not.toContain('只在二校');

    const none = await get('none', path);
    expect(none.data).toEqual([]);
    expect(none.meta).toMatchObject({ total: 0, totalAmount: 0 });
  });

  it('區間查詢指名範圍外的學生（studentId）：受限的拿到空的', async () => {
    const c1 = await get('c1', `/api/meals?dateFrom=${DAY}&dateTo=${DAY}&studentId=${fx.b}`);
    expect(c1.data).toEqual([]);
    expect(c1.meta.total).toBe(0);
  });

  it('單日名單：受限 C1 的候選與摘要都沒有只在 C2 的學生', async () => {
    const path = `/api/meals?date=${DAY}`;
    const all = await get('all', path);
    expect(ids(all)).toEqual(new Set([fx.a, fx.b, fx.ab]));

    const c1 = await get('c1', path);
    expect(ids(c1)).toEqual(new Set([fx.a, fx.ab]));
    expect(c1.meta).toMatchObject({ total: 2, totalAmount: 160 });

    expect((await get('none', path)).data).toEqual([]);
  });

  it('批次寫入：受限 C1 寫範圍外的學生整批 404、對方的記錄不變；範圍內照常', async () => {
    const before = await priceOf(fx.b);
    const out = await as('c1', '/api/meals/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: DAY,
        // 混一筆範圍內的：整批拒絕，不部分成功
        rows: [
          { studentId: fx.a, ordered: true, chargeable: true, unitPrice: 91 },
          { studentId: fx.b, ordered: true, chargeable: true, unitPrice: 99 },
        ],
      }),
    });
    expect(out.status).toBe(404);
    expect(await priceOf(fx.b)).toBe(before);
    expect(await priceOf(fx.a)).toBe(80);

    expect((await batch('none', fx.a, 95)).status).toBe(404);
    expect(await priceOf(fx.a)).toBe(80);

    const inScope = await batch('c1', fx.ab, 85);
    expect(inScope.status).toBe(200);
    expect(await priceOf(fx.ab)).toBe(85);
  });

  it('不受限的管理員照舊：寫得到 C2 的學生', async () => {
    const res = await batch('all', fx.b, 70);
    expect(res.status).toBe(200);
    expect(await priceOf(fx.b)).toBe(70);
  });
});
