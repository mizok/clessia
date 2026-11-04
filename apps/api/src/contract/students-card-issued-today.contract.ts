import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * #2267「今天發的卡」篩選，對真的本機 PostgREST 跑：條件是 embed `active_card`（沒作廢）＋發卡時間在
 * 台北今天＋embed 非空；年級章節是 12 支帶同一份條件的 HEAD count。替身不解析 embed 的過濾，量不到。
 *
 * 自建一個 org、兩間分校、四位國一學生：A 校今天發（要回）、A 校昨天發、A 校今天發但作廢、B 校今天發。
 * 受限管理員（只管 A 校）看不到 B 校那位。
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

run('學生列表「今天發的卡」篩選（#2267）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const fx = { campusA: '', campusB: '', todayA: '', yesterdayA: '', revokedA: '', todayB: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#2267 契約：今天發的卡') returning id",
      )
    )[0]!.id;
    const campus = async (name: string) =>
      (
        await q<{ id: string }>('insert into campuses (org_id, name) values ($1, $2) returning id', [
          ctx.orgId,
          name,
        ])
      )[0]!.id;
    fx.campusA = await campus('A 校');
    fx.campusB = await campus('B 校');
    const [subject] = await q<{ id: string }>(
      "insert into subjects (org_id, name) values ($1, '數學') returning id",
      [ctx.orgId],
    );
    /** 學生＋在那間分校的一筆報名（分校範圍看報名的班） */
    const student = async (name: string, campusId: string) => {
      const [course] = await q<{ id: string }>(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4) returning id',
        [ctx.orgId, campusId, name, subject!.id],
      );
      const [klass] = await q<{ id: string }>(
        "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '班') returning id",
        [ctx.orgId, campusId, course!.id],
      );
      const [s] = await q<{ id: string }>(
        "insert into students (org_id, name, grade) values ($1, $2, 'J1') returning id",
        [ctx.orgId, name],
      );
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
        [ctx.orgId, klass!.id, s!.id],
      );
      return s!.id;
    };
    fx.todayA = await student('A 校今天發', fx.campusA);
    fx.yesterdayA = await student('A 校昨天發', fx.campusA);
    fx.revokedA = await student('A 校今天發但作廢', fx.campusA);
    fx.todayB = await student('B 校今天發', fx.campusB);
    const card = (studentId: string, code: string, issuedAt: string, revoked = false) =>
      q(
        `insert into checkin_cards (org_id, student_id, code, issued_at, revoked_at, revoke_reason)
         values ($1, $2, $3, ${issuedAt}, ${revoked ? "now(), '遺失'" : 'null, null'})`,
        [ctx.orgId, studentId, code],
      );
    // 「今天」照台北：台北今天 00:00 就算今天、前一刻算昨天
    const midnight = "(date_trunc('day', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei')";
    await card(fx.todayA, 'CK1-AAAAAAAAAAAAAAA1', midnight);
    await card(fx.yesterdayA, 'CK1-AAAAAAAAAAAAAAA2', `${midnight} - interval '1 second'`);
    await card(fx.revokedA, 'CK1-AAAAAAAAAAAAAAA3', 'now()', true);
    await card(fx.todayB, 'CK1-AAAAAAAAAAAAAAA4', 'now()');
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from checkin_cards where org_id = $1',
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

  type List = {
    data: Array<{ id: string; hasActiveCard: boolean }>;
    summary: { byGrade: Array<{ grade: string; count: number }> };
    meta: { total: number };
  };
  const list = async (query: string) => {
    const res = await app.request(`/api/students?withToday=false&pageSize=100${query}`, {}, env);
    expect(res.status).toBe(200);
    return (await res.json()) as List;
  };
  const chapters = (body: List) => body.summary.byGrade.reduce((n, g) => n + g.count, 0);

  it('全校管理員：今天發、沒作廢的兩位（A、B 校）；昨天發、作廢的不算；總數與章節計數同一份', async () => {
    ctx.campusScope = null;
    const body = await list('&cardIssuedToday=true');
    expect(new Set(body.data.map((s) => s.id))).toEqual(new Set([fx.todayA, fx.todayB]));
    expect(body.data.every((s) => s.hasActiveCard)).toBe(true);
    expect(body.meta.total).toBe(2);
    expect(chapters(body)).toBe(2);
  });

  it('受限管理員（只管 A 校）：B 校今天發的看不到，總數與章節都是 1', async () => {
    ctx.campusScope = [fx.campusA];
    try {
      const body = await list('&cardIssuedToday=true');
      expect(body.data.map((s) => s.id)).toEqual([fx.todayA]);
      expect(body.meta.total).toBe(1);
      expect(chapters(body)).toBe(1);
    } finally {
      ctx.campusScope = null;
    }
  });

  it('跟其他條件是交集：再加年級 P1 → 0 位', async () => {
    const none = await list('&cardIssuedToday=true&grade=P1');
    expect(none.data).toEqual([]);
    expect(none.meta.total).toBe(0);
    // 年級章節本來就不吃「年級」條件（選單要顯示各級人數），所以這裡還是 2
    expect(chapters(none)).toBe(2);
  });
});
