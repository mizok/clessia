import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **聯絡簿三支 GET 套分校範圍**（#1994），對真的本機 PostgREST 跑 —— 範圍條件在 join 裡
 * （`scope_student:students!inner(enrollments!inner(classes!inner(campus_id)))`），替身不解析 embed 的過濾，量不到。
 *
 * 自建一個 org：兩個分校各一個開聯絡簿的班；a 只在 C1、b 只在 C2、ab 兩邊都有。
 * 受限 C1 的管理員：列表只看得到 a 與 ab 的聯絡簿；缺漏名單與統計裡沒有 b；
 * 空範圍什麼都看不到。測完整個 org 刪掉。
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

run('聯絡簿三支 GET 的分校範圍（#1994）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const WRITTEN = '2026-09-01';
  const MISSING = '2026-09-02';
  const fx = { c1: '', c2: '', a: '', b: '', ab: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#1994 契約：聯絡簿分校範圍') returning id",
      )
    )[0]!.id;
    const [subject] = await q<{ id: string }>(
      "insert into subjects (org_id, name) values ($1, '國語') returning id",
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
        [ctx.orgId, campus!.id, `國語 ${key}`, subject!.id],
      );
      const [k] = await q<{ id: string }>(
        `insert into classes (org_id, campus_id, course_id, name, uses_contact_book)
         values ($1, $2, $3, $4, true) returning id`,
        [ctx.orgId, campus!.id, course!.id, `班 ${key}`],
      );
      klass[key] = k!.id;
      // 兩天都有課：缺漏名單只算「那天有課」的班
      for (const date of [WRITTEN, MISSING]) {
        await q(
          `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
           values ($1, $2, $3, '18:00', '19:00', 'scheduled', 'unassigned')`,
          [ctx.orgId, k!.id, date],
        );
      }
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
      // WRITTEN 那天每個人都寫了；MISSING 那天都沒寫
      await q(
        `insert into contact_book_entries (org_id, student_id, entry_date, content)
         values ($1, $2, $3, $4)`,
        [ctx.orgId, s!.id, WRITTEN, `${name} 的聯絡簿`],
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
      'delete from contact_book_entries where org_id = $1',
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

  const get = async <T>(path: string, scope: 'all' | 'c1' | 'none') => {
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx.c1] : [];
    try {
      const res = await app.request(path, {}, env);
      expect(res.status).toBe(200);
      return (await res.json()) as T;
    } finally {
      ctx.campusScope = null;
    }
  };
  type List = { data: Array<{ studentId: string; content: string }>; meta: { total: number } };
  type Missing = { data: Array<{ studentId: string }>; meta: { total: number } };
  type Summary = { data: Array<{ date: string; missingCount: number }> };

  it('列表：受限 C1 只看得到 C1 學生（含跨校的）的聯絡簿，別校的內容不出現', async () => {
    const path = `/api/contact-book?from=${WRITTEN}&to=${WRITTEN}`;
    const all = await get<List>(path, 'all');
    expect(new Set(all.data.map((r) => r.studentId))).toEqual(new Set([fx.a, fx.b, fx.ab]));

    const c1 = await get<List>(path, 'c1');
    expect(new Set(c1.data.map((r) => r.studentId))).toEqual(new Set([fx.a, fx.ab]));
    expect(c1.meta.total).toBe(2);
    expect(JSON.stringify(c1)).not.toContain('只在二校');

    const none = await get<List>(path, 'none');
    expect(none).toEqual({ data: [], meta: { total: 0 } });
  });

  it('缺漏名單：受限 C1 的名單裡沒有只在 C2 的學生', async () => {
    const path = `/api/contact-book/missing?date=${MISSING}`;
    const all = await get<Missing>(path, 'all');
    expect(all.data.map((r) => r.studentId)).toContain(fx.b);

    const c1 = await get<Missing>(path, 'c1');
    const ids = new Set(c1.data.map((r) => r.studentId));
    expect(ids.has(fx.b)).toBe(false);
    expect(ids.has(fx.a)).toBe(true);
    expect(ids.has(fx.ab)).toBe(true);

    expect((await get<Missing>(path, 'none')).data).toEqual([]);
  });

  it('缺漏統計：受限 C1 的數字等於它自己的缺漏名單，不含只在 C2 的學生', async () => {
    const path = `/api/contact-book/missing/summary?dateFrom=${MISSING}&dateTo=${MISSING}`;
    const all = await get<Summary>(path, 'all');
    const c1 = await get<Summary>(path, 'c1');
    const c1List = await get<Missing>(`/api/contact-book/missing?date=${MISSING}`, 'c1');
    expect(c1.data).toEqual([{ date: MISSING, missingCount: c1List.meta.total }]);
    expect(c1.data[0]!.missingCount).toBeLessThan(all.data[0]!.missingCount);
    expect(await get<Summary>(path, 'none')).toMatchObject({
      data: [{ date: MISSING, missingCount: 0 }],
    });
  });
});
