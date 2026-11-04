import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2227 第 2 張：「今天有課的班 → 在籍學生」改在 DB 端篩**，對真的本機 PostgREST 跑。
 *
 * 原本作業台（日到班）的應到名單與餐費單日的候選，都先拿到今天有課的班 id、再 `.in('class_id', …)`
 * 回 enrollments：班一多就 414 —— 作業台整頁 500，餐費的錯誤沒看，候選靜默變空、回 200。
 * fixture：同一天 BIG 個 A 校班各一堂、每班 PER 人；另有一個 A 校停課班（只在那班的學生不該到）、
 * 一個 B 校班。
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
      const authPool = {
        query: pool!.query.bind(pool),
        connect: pool!.connect.bind(pool),
        end: async () => undefined,
      };
      set('supabase', supabase);
      set('orgId', ctx.orgId);
      set('userId', ctx.userId);
      set('roles', ['admin']);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', 'admin');
      set('studentScope', null);
      set('campusScope', ctx.campusScope);
      set('auth', { pool: authPool });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: ctx.campusScope ?? [] });
      await next();
    }),
  };
});

const BIG = 300;
const PER = 2;
const D = '2027-03-03';

run('#2227 第 2 張：今天有課的在籍學生在 DB 端篩（作業台日到班、餐費單日）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const fx = {
    campusA: '',
    campusB: '',
    held: [] as string[],
    off: [] as string[],
    b: [] as string[],
  };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name, attendance_mode) values ('#2227 契約：今天的在籍', 'daily_checkin') returning id",
      )
    )[0]!.id;
    [fx.campusA, fx.campusB] = (
      await q<{ id: string }>(
        "insert into campuses (org_id, name) values ($1, 'A 校'), ($1, 'B 校') returning id",
        [ctx.orgId],
      )
    ).map((r) => r.id) as [string, string];
    const [subject] = await q<{ id: string }>(
      "insert into subjects (org_id, name) values ($1, '數學') returning id",
      [ctx.orgId],
    );
    const [course] = await q<{ id: string }>(
      "insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, '數學', $3) returning id",
      [ctx.orgId, fx.campusA, subject!.id],
    );
    const classes = await q<{ id: string; campus_id: string; name: string }>(
      `insert into classes (org_id, campus_id, course_id, name)
       select $1::uuid, $2::uuid, $4::uuid, '班 ' || lpad(n::text, 3, '0') from generate_series(1, ${BIG}) n
       union all select $1::uuid, $2::uuid, $4::uuid, '停課班'
       union all select $1::uuid, $3::uuid, $4::uuid, 'B 校班'
       returning id, campus_id, name`,
      [ctx.orgId, fx.campusA, fx.campusB, course!.id],
    );
    await q(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
       select $1, c.id, $2, '18:00', '19:00',
              case when c.name = '停課班' then 'cancelled' else 'scheduled' end,
              'unassigned'
         from classes c where c.org_id = $1`,
      [ctx.orgId, D],
    );
    const students = await q<{ id: string; class_name: string }>(
      `with st as (
         insert into students (org_id, name, grade)
         select $1, c.id::text || '#' || k, 'J1'
           from classes c, generate_series(1, ${PER}) k where c.org_id = $1
         returning id, name),
       en as (
         insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         select $1, split_part(st.name, '#', 1)::uuid, st.id, 'active', 'monthly', 1000, '2027-01-01'
           from st
         returning class_id, student_id)
       select en.student_id as id, c.name as class_name
         from en join classes c on c.id = en.class_id`,
      [ctx.orgId],
    );
    for (const s of students) {
      if (s.class_name === '停課班') fx.off.push(s.id);
      else if (s.class_name === 'B 校班') fx.b.push(s.id);
      else fx.held.push(s.id);
    }
    app = (await import('../index')).default as never;
  }, 300_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from meal_records where org_id = $1',
      'delete from daily_checkins where org_id = $1',
      'delete from leave_requests where org_id = $1',
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
  }, 300_000);

  const sorted = (ids: string[]) => [...ids].sort();
  const expected = async () => {
    const res = await app.request(`/api/workbench/today?date=${D}`, {}, env);
    const body = (await res.json()) as { expected?: Array<{ studentId: string }> };
    return { status: res.status, ids: sorted((body.expected ?? []).map((s) => s.studentId)) };
  };
  const meals = async () => {
    const res = await app.request(`/api/meals?date=${D}`, {}, env);
    const body = (await res.json()) as { data?: Array<{ studentId: string }> };
    return { status: res.status, ids: sorted((body.data ?? []).map((s) => s.studentId)) };
  };

  it(`作業台（日到班、不受限）：${BIG} 個班有課，應到 = 有課班的學生，停課班的不在`, async () => {
    ctx.campusScope = null;
    expect(await expected()).toEqual({ status: 200, ids: sorted([...fx.held, ...fx.b]) });
  });

  it('作業台（受限：只管 A 校）：B 校的學生不在應到', async () => {
    ctx.campusScope = [fx.campusA];
    expect(await expected()).toEqual({ status: 200, ids: sorted(fx.held) });
  });

  it('餐費單日（不受限）：候選 = 當天有課班的在籍學生（停課照列，見 meals.ts 註解）', async () => {
    ctx.campusScope = null;
    expect(await meals()).toEqual({
      status: 200,
      ids: sorted([...fx.held, ...fx.off, ...fx.b]),
    });
  });

  it('餐費單日（受限：只管 A 校）：B 校的學生不在候選', async () => {
    ctx.campusScope = [fx.campusA];
    expect(await meals()).toEqual({ status: 200, ids: sorted([...fx.held, ...fx.off]) });
  });
});
