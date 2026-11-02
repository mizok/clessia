import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **家長列表的分校範圍與 `campusId`**（K4，#1314 盤點；保留類：授權面），對真的本機 PostgREST 跑 ——
 * 範圍條件在 embed 裡（`parent_student_relations!inner(students!inner(enrollments!inner(classes!inner(campus_id))))`），
 * 替身不解析 embed 的過濾，量不到。
 *
 * 自建一個 org：兩個分校各一個班；學生 a 只在 C1、b 只在 C2、ab 兩邊都有；家長 pa→a、pb→b、pab→ab。
 * 守：頂欄指名分校會縮到那一間；受限的指名別校 403（撐不大範圍）；摘要的各狀態人數跟列表同一個範圍；
 * 範圍內家長幾百位時不會因為 id 塞進 URL 而 414（原本的 `.in('id', 家長 ids)`）。測完整個 org 刪掉。
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

run('家長列表的分校範圍與 campusId（K4）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const fx = { c1: '', c2: '', k1: '', pa: '', pb: '', pab: '' };
  /** parents 的 (user_id, org_id) 唯一：每位測試家長借一位 seed 既有使用者（c2 不寫 ba_*） */
  let users: string[] = [];

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    users = (await q<{ id: string }>('select id from ba_user order by id')).map((u) => u.id);
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('K4 契約：家長列表分校') returning id",
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
    }
    fx.k1 = klass['c1']!;
    const family = async (name: string, classes: string[]) => {
      const [s] = await q<{ id: string }>(
        "insert into students (org_id, name, grade) values ($1, $2, 'P5') returning id",
        [ctx.orgId, `${name}的孩子`],
      );
      for (const k of classes) {
        await q(
          `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
           values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
          [ctx.orgId, k, s!.id],
        );
      }
      const [p] = await q<{ id: string }>(
        'insert into parents (org_id, name, user_id) values ($1, $2, $3) returning id',
        [ctx.orgId, name, users.shift()!],
      );
      await q('insert into parent_student_relations (parent_id, student_id) values ($1, $2)', [
        p!.id,
        s!.id,
      ]);
      return p!.id;
    };
    fx.pa = await family('只在一校', [klass['c1']!]);
    fx.pb = await family('只在二校', [klass['c2']!]);
    fx.pab = await family('兩校都有', [klass['c1']!, klass['c2']!]);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from parent_student_relations where parent_id in (select id from parents where org_id = $1)',
      'delete from parents where org_id = $1',
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
  type List = {
    data: Array<{ id: string }>;
    summary: { total: number; activeCount: number };
    meta: { total: number };
  };
  const as = async (scope: Scope, path: string) => {
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx.c1] : [];
    try {
      return await app.request(path, {}, env);
    } finally {
      ctx.campusScope = null;
    }
  };
  const get = async (scope: Scope, path: string) => {
    const res = await as(scope, path);
    expect(res.status).toBe(200);
    return (await res.json()) as List;
  };
  const ids = (l: List) => new Set(l.data.map((p) => p.id));

  it('沒帶 campusId：不受限看全部、受限 C1 看 C1（含跨校的）、空範圍什麼都沒有', async () => {
    const all = await get('all', '/api/parents?pageSize=100');
    expect(ids(all)).toEqual(new Set([fx.pa, fx.pb, fx.pab]));
    expect(all.summary.total).toBe(3);

    const c1 = await get('c1', '/api/parents?pageSize=100');
    expect(ids(c1)).toEqual(new Set([fx.pa, fx.pab]));
    expect(c1.meta.total).toBe(2);
    expect(c1.summary).toMatchObject({ total: 2, activeCount: 2 });

    const none = await get('none', '/api/parents?pageSize=100');
    expect(none.data).toEqual([]);
    expect(none.summary.total).toBe(0);
  });

  // 一個分校都沒被指派：`campusFilterIds` 回 []，條件是 `.in(PARENT_SCOPE_FILTER, [])` → `in.()`。
  // 本機 PostgREST 實測（11-02）：embed 路徑上的 `in.()` 是 200、零筆（不加條件時 28 筆），不是 400、也不是不篩
  it('一個分校都沒被指派（scope=[]）：列表空、摘要各狀態 0、200 不是 400', async () => {
    const res = await as('none', '/api/parents?pageSize=100');
    expect(res.status).toBe(200);
    const body = (await res.json()) as List;
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
    expect(body.summary).toMatchObject({ total: 0, activeCount: 0 });
  });

  it('不受限的管理員指名 C2：列表與摘要都只剩 C2 的家長', async () => {
    const c2 = await get('all', `/api/parents?pageSize=100&campusId=${fx.c2}`);
    expect(ids(c2)).toEqual(new Set([fx.pb, fx.pab]));
    expect(c2.meta.total).toBe(2);
    expect(c2.summary.total).toBe(2);
  });

  it('受限 C1 指名自己的 C1 跟不帶一樣；指名別校 C2 是 403，撐不大範圍', async () => {
    const own = await get('c1', `/api/parents?pageSize=100&campusId=${fx.c1}`);
    expect(ids(own)).toEqual(new Set([fx.pa, fx.pab]));

    expect((await as('c1', `/api/parents?campusId=${fx.c2}`)).status).toBe(403);
  });

  it('搜尋與分校一起用：條件是交集', async () => {
    const hit = await get(
      'all',
      `/api/parents?pageSize=100&campusId=${fx.c2}&search=${encodeURIComponent('一校')}`,
    );
    expect(hit.data).toEqual([]);
  });

  // #1928 型：範圍不能靠「先撈家長 id 再 `.in('id', …)`」—— 一個分校幾百位家長，id 進 GET URL 約 200 個就 414。
  // seed 的使用者不夠建幾百位家長（一人一帳號、c2 不建 ba_*），所以直接看送出去的請求：查家長的 URL 裡不能有 id 清單
  it('範圍與 campusId 不靠家長 id 清單：多位家長時 200、總數正確，請求 URL 裡沒有 id=in.(…)', async () => {
    const many = users.splice(0, 120);
    await q(
      `with s as (
         insert into students (org_id, name, grade)
         select $1, '大量孩子 ' || g, 'P5' from generate_series(1, $3::int) g
         returning id, name
       ), e as (
         insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         select $1, $2, id, 'active', 'monthly', 1000, '2026-01-01' from s
       ), p as (
         insert into parents (org_id, name, user_id)
         select $1, '大量家長 ' || u.n, u.id
         from unnest($4::text[]) with ordinality as u(id, n)
         returning id, name
       )
       -- 第 n 位家長配第 n 個孩子（名字後綴同一個 n）
       insert into parent_student_relations (parent_id, student_id)
       select p.id, s.id from p join s on substring(p.name from 6) = substring(s.name from 6)`,
      [ctx.orgId, fx.k1, many.length, many],
    );
    const total = 2 + many.length;

    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      urls.push(
        typeof input === 'string' ? input : input instanceof Request ? input.url : input.href,
      );
      return realFetch(input, init);
    });
    try {
      const c1 = await get('c1', '/api/parents?pageSize=20');
      expect(c1.meta.total).toBe(total);
      expect(c1.summary.total).toBe(total);

      const pick = await get('all', `/api/parents?pageSize=20&campusId=${fx.c1}`);
      expect(pick.meta.total).toBe(total);
    } finally {
      spy.mockRestore();
    }
    const parentQueries = urls.filter((u) => u.includes('/rest/v1/parents?'));
    expect(parentQueries.length).toBeGreaterThan(0);
    for (const u of parentQueries) expect(decodeURIComponent(u)).not.toMatch(/[?&]id=in\./);
  });
});
