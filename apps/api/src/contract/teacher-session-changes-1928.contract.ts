import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { createServiceClientFromEnv } from '../lib/supabase';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

/**
 * `GET /api/teacher/session-changes` 不把 id 清單放進 URL（#1928 A#11，計畫席 11-05 裁定）。
 *
 * 舊寫法先撈 31 天內可見課堂的 id，再 `.in('session_id', ids)` —— 排課多的老師 >200 堂就 414（500）。
 * 新寫法一支 pg SQL：任期判準照舊由 `loadTenure` 算（現任班、前任段），SQL 只用 `= any` 接清單。
 *
 * 自建一個 org：
 * - K：我現任的班，區間內 31 天 × 8 個時段 ＝ 248 堂，每堂一筆異動（舊碼 414 的那題）
 * - P：我前任的班（教到 X−1，別的老師從 X 起）—— 任期內一堂看得到、任期外一堂看不到
 * - T：別的老師的班 —— 看不到；但其中一堂由我代課 → 看得到
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

const ctx = { orgId: '', userId: '' };

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
      set('roles', ['teacher']);
      set('permissions', []);
      set('activeRole', 'teacher');
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', null);
      set('auth', { pool: { query: pool!.query.bind(pool), end: async () => {} } });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

run('老師課務異動：>200 堂不 414、任期外與別人的班看不到（#1928 A#11）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const TODAY = getCurrentTaipeiDateString();
  const FROM = shift(TODAY, -30);
  const X = shift(TODAY, -14); // P 從這天起換老師
  const fx = { me: '', other: '', inTerm: '', outOfTerm: '', theirs: '', sub: '' };

  beforeAll(async () => {
    const users = await q<{ user_id: string }>(
      "select distinct user_id from user_roles where role = 'teacher' order by user_id limit 2",
    );
    [fx.me, fx.other] = users.map((u) => u.user_id) as [string, string];
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#1928 A#11 契約：老師課務異動') returning id",
      )
    )[0]!.id;
    const one = async (sql: string, values: unknown[]) =>
      (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
    const campus = await one('insert into campuses (org_id, name) values ($1, $2)', [
      ctx.orgId,
      'c',
    ]);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    const course = await one(
      'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
      [ctx.orgId, campus, '數學', subject],
    );
    const klass = (name: string) =>
      one('insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)', [
        ctx.orgId,
        campus,
        course,
        name,
      ]);
    const [K, P, T] = [await klass('K 現任'), await klass('P 前任'), await klass('T 別人')];
    const staffMe = await one(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '我')",
      [ctx.orgId, fx.me],
    );
    const staffOther = await one(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '別的老師')",
      [ctx.orgId, fx.other],
    );
    await q(
      `insert into schedules (class_id, weekday, start_time, end_time, teacher_id, effective_from, effective_to)
       values ($1, 1, '18:00', '19:00', $2, $5, null),
              ($3, 1, '18:00', '19:00', $2, $5, $6), ($3, 1, '18:00', '19:00', $4, $7, null),
              ($8, 1, '18:00', '19:00', $4, $5, null)`,
      [K, staffMe, P, staffOther, shift(TODAY, -100), shift(X, -1), X, T],
    );
    // K：31 天 × 8 個時段，全部 unassigned（不靠 sessions.teacher_id，純粹靠現任班）
    await q(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
       select $1, $2, d::date, make_time(10 + h, 0, 0), make_time(10 + h, 50, 0), 'scheduled', 'unassigned'
       from generate_series($3::date, $4::date, interval '1 day') d, generate_series(0, 7) h`,
      [ctx.orgId, K, FROM, TODAY],
    );
    const session = (classId: string, date: string, teacher: string | null) =>
      one(
        `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status, teacher_id)
         values ($1, $2, $3, '18:00', '19:00', 'scheduled', $4, $5)`,
        [ctx.orgId, classId, date, teacher ? 'assigned' : 'unassigned', teacher],
      );
    fx.inTerm = await session(P, shift(X, -3), null);
    fx.outOfTerm = await session(P, shift(X, 3), staffOther);
    fx.theirs = await session(T, shift(TODAY, -2), staffOther);
    fx.sub = await session(T, shift(TODAY, -1), staffMe);
    await q(
      `insert into schedule_changes (org_id, session_id, change_type, reason)
       select $1, id, 'time_change', id::text from sessions where org_id = $1`,
      [ctx.orgId],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from schedule_changes where org_id = $1',
      'delete from sessions where org_id = $1',
      'delete from schedules where class_id in (select id from classes where org_id = $1)',
      'delete from classes where org_id = $1',
      'delete from courses where org_id = $1',
      'delete from subjects where org_id = $1',
      'delete from staff where org_id = $1',
      'delete from campuses where org_id = $1',
      'delete from audit_logs where org_id = $1',
      'delete from organizations where id = $1',
    ]) {
      await q(sql, [ctx.orgId]);
    }
  }, 120_000);

  /** 一頁一頁翻完，回每一筆異動的 sessionId */
  const allSessionIds = async () => {
    ctx.userId = fx.me;
    const ids: string[] = [];
    let total = -1;
    for (let page = 1; page <= 10; page++) {
      const res = await app.request(
        `/api/teacher/session-changes?from=${FROM}&to=${TODAY}&pageSize=100&page=${page}`,
        {},
        env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: Array<{ sessionId: string }>;
        meta: { total: number };
      };
      total = body.meta.total;
      ids.push(...body.data.map((r) => r.sessionId));
      if (body.data.length < 100) break;
    }
    return { ids, total };
  };

  it('248 堂現任班＋任期內一堂＋代課一堂：200、總數 250、翻頁不重複不漏', async () => {
    const { ids, total } = await allSessionIds();
    expect(total).toBe(250);
    expect(ids).toHaveLength(250);
    expect(new Set(ids).size).toBe(250);
    expect(ids).toContain(fx.inTerm);
    expect(ids).toContain(fx.sub);
  });

  it('前任班任期外的那堂看不到', async () => {
    const { ids } = await allSessionIds();
    expect(ids).not.toContain(fx.outOfTerm);
  });

  it('別的老師的班看不到（除了我代課的那堂）', async () => {
    const { ids } = await allSessionIds();
    expect(ids).not.toContain(fx.theirs);
  });
});
