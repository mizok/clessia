import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * 請假列表每張假帶「蓋到哪幾堂」與學生年級（#1314 LV2，使用者 11-05 裁定「都列」）。
 *
 * 只填日期區間的假也要算：跟點名面板同一支 `leaveCoversSession`（＋在籍 `isEnrolledOn`、停課
 * `isCancelledSession`）。候選堂由一支 pg SQL 撈（條件在 SQL 裡，不把 id 清單放進 URL，#1928），
 * 判準留在 lib。自建一個 org：
 *
 * - 學生 S：A 班（A 分校）06-01 起在籍；B 班（B 分校）06-01～06-02 在籍；C 班（A 分校）沒報
 * - 假 1（整天、06-01～06-03）：A 06-01 早／午、A 06-02、B 06-02；**不含** A 06-03（停課）、B 06-03（已離班）、C
 * - 假 2（單日 06-04 13:00–16:00）：只有 A 06-04 午那堂，不含早上那堂
 * - 假 3（綁 A 06-05 早）：只有那一堂，同天午那堂不算
 * - 只管 A 分校的管理員：假 1 不列 B 班那堂
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

const ctx = { orgId: '', userId: '', campusScope: null as readonly string[] | null };

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
      set('auth', { pool: { query: pool!.query.bind(pool), end: async () => {} } });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

interface Covered {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  className: string;
}

run('請假列表帶蓋到的堂與年級（#1314 LV2）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const s: Record<string, string> = {};
  const leave = { whole: '', window: '', bound: '' };
  let campusA = '';

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('LV2 契約：請假蓋到的堂') returning id",
      )
    )[0]!.id;
    const org = ctx.orgId;
    const one = async (sql: string, values: unknown[]) =>
      (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
    campusA = await one("insert into campuses (org_id, name) values ($1, 'A 分校')", [org]);
    const campusB = await one("insert into campuses (org_id, name) values ($1, 'B 分校')", [org]);
    const subject = await one("insert into subjects (org_id, name) values ($1, '數學')", [org]);
    const course = await one(
      "insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, '數學', $3)",
      [org, campusA, subject],
    );
    const klass = (campus: string, name: string) =>
      one('insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)', [
        org,
        campus,
        course,
        name,
      ]);
    const [A, B, C] = [
      await klass(campusA, 'A 班'),
      await klass(campusB, 'B 班'),
      await klass(campusA, 'C 班'),
    ];
    const student = await one(
      "insert into students (org_id, name, grade) values ($1, 'S 生', 'J2')",
      [org],
    );
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, effective_from, effective_to)
       values ($1, $2, $4, 'active', '2026-06-01', null), ($1, $3, $4, 'active', '2026-06-01', '2026-06-02')`,
      [org, A, B, student],
    );
    const session = (
      key: string,
      classId: string,
      date: string,
      start: string,
      status = 'scheduled',
    ) =>
      one(
        `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
         values ($1, $2, $3, $4::time, $4::time + interval '1 hour', $5, 'unassigned')`,
        [org, classId, date, start, status],
      ).then((id) => (s[key] = id));
    await session('a1am', A, '2026-06-01', '10:00');
    await session('a1pm', A, '2026-06-01', '14:00');
    await session('a2', A, '2026-06-02', '10:00');
    await session('a3cancelled', A, '2026-06-03', '10:00', 'cancelled');
    await session('b2', B, '2026-06-02', '18:00');
    await session('b3left', B, '2026-06-03', '18:00');
    await session('c1', C, '2026-06-01', '10:00');
    await session('a4am', A, '2026-06-04', '10:00');
    await session('a4pm', A, '2026-06-04', '14:00');
    await session('a5am', A, '2026-06-05', '10:00');
    await session('a5pm', A, '2026-06-05', '14:00');

    const addLeave = (from: string, to: string, start: string | null, end: string | null) =>
      one(
        `insert into leave_requests (org_id, student_id, start_date, end_date, start_time, end_time, submitted_by, submitted_by_role)
         values ($1, $2, $3, $4, $5, $6, $7, 'admin')`,
        [org, student, from, to, start, end, ctx.userId],
      );
    leave.whole = await addLeave('2026-06-01', '2026-06-03', null, null);
    leave.window = await addLeave('2026-06-04', '2026-06-04', '13:00', '16:00');
    leave.bound = await addLeave('2026-06-05', '2026-06-05', null, null);
    await q(
      'insert into leave_request_sessions (leave_request_id, session_id, org_id) values ($1, $2, $3)',
      [leave.bound, s['a5am'], org],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const t of [
      'leave_request_sessions',
      'leave_requests',
      'sessions',
      'enrollments',
      'students',
      'classes',
      'courses',
      'subjects',
      'campuses',
    ])
      await q(`delete from ${t} where org_id = $1`, [ctx.orgId]);
    await q('delete from organizations where id = $1', [ctx.orgId]);
  }, 120_000);

  const list = async (scope: readonly string[] | null = null) => {
    ctx.campusScope = scope;
    const res = await app.request('/api/leaves?pageSize=100', {}, env);
    const body = (await res.json()) as {
      data: Array<{ id: string; studentGrade: string | null; coveredSessions: Covered[] }>;
    };
    const byId = new Map((body.data ?? []).map((r) => [r.id, r]));
    const ids = (leaveId: string) => (byId.get(leaveId)?.coveredSessions ?? []).map((x) => x.id);
    return { status: res.status, byId, ids };
  };

  it('只填日期區間的整天假：在籍的班、沒停課的堂都列，依日期時間排', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.ids(leave.whole)).toEqual([s['a1am'], s['a1pm'], s['a2'], s['b2']]);
    expect(res.byId.get(leave.whole)?.coveredSessions[0]).toEqual({
      id: s['a1am'],
      date: '2026-06-01',
      startTime: '10:00',
      endTime: '11:00',
      className: 'A 班',
    });
  });

  it('單日時間窗：只列重疊的那堂', async () => {
    expect((await list()).ids(leave.window)).toEqual([s['a4pm']]);
  });

  it('綁定堂次：只列綁的那堂', async () => {
    expect((await list()).ids(leave.bound)).toEqual([s['a5am']]);
  });

  it('帶學生年級', async () => {
    expect((await list()).byId.get(leave.whole)?.studentGrade).toBe('J2');
  });

  it('只管 A 分校的管理員：不列 B 分校那堂', async () => {
    const res = await list([campusA]);
    expect(res.status).toBe(200);
    expect(res.ids(leave.whole)).toEqual([s['a1am'], s['a1pm'], s['a2']]);
  });
});
