import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2227：課堂摘要的出勤／在籍／考試數走 pg、在 DB 端數**，對真的本機 PostgREST／Postgres 跑。
 *
 * 原本 `summariseSessions` 拿當天（或一頁）的 event／class id 發三支 PostgREST `.in()`：
 * 作業台一次是範圍內**全部**課堂，班一多就 414，錯誤被吞成 0；就算不 414，出勤列（堂數 × 人數）
 * 破千也會被 max_rows 1000 靜默截斷。fixture：同一天 BIG 個班各一堂、每班 PER 個學生都點了出席
 * （BIG × PER > 1000），另有一個別分校的班。
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

const ctx: {
  orgId: string;
  userId: string;
  roles: string[];
  campusScope: string[] | null;
  failPool: boolean;
} = { orgId: '', userId: '', roles: ['admin'], campusScope: null, failPool: false };

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
      const query = ctx.failPool
        ? async () => {
            throw new Error('contract 2227: pool down');
          }
        : pool!.query.bind(pool);
      const authPool = { query, connect: pool!.connect.bind(pool), end: async () => undefined };
      const admin = ctx.roles.includes('admin');
      set('supabase', supabase);
      set('orgId', ctx.orgId);
      set('userId', ctx.userId);
      set('roles', ctx.roles);
      set('permissions', admin ? [...PERMISSIONS] : []);
      set('activeRole', admin ? 'admin' : 'teacher');
      set('studentScope', null);
      set('campusScope', ctx.campusScope);
      set('auth', { pool: authPool });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: ctx.campusScope ?? [] });
      await next();
    }),
  };
});

const BIG = 300;
const PER = 4;
const D = '2027-03-02';

interface Summary {
  classId: string;
  enrolledCount: number;
  presentCount: number;
  examCount: number;
}

run('#2227 課堂摘要的計數在 DB 端數（GET /workbench/today、/attendance/sessions）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const fx = { campusA: '', campusB: '', other: '', first: '', mine: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        // 逐堂點名：日到班模式的作業台另外走 `loadDailyAttendance`（#2227 第 2 張），這裡只量摘要
        "insert into organizations (name, attendance_mode) values ('#2227 契約：課堂摘要', 'per_session') returning id",
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
    const [teacher] = await q<{ id: string }>(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '老師') returning id",
      [ctx.orgId, ctx.userId],
    );
    const classes = await q<{ id: string }>(
      `insert into classes (org_id, campus_id, course_id, name)
       select $1, $2, $3, '班 ' || lpad(n::text, 3, '0') from generate_series(1, ${BIG}) n
       returning id`,
      [ctx.orgId, fx.campusA, course!.id],
    );
    fx.first = classes[0]!.id;
    fx.mine = classes[1]!.id;
    fx.other = (
      await q<{ id: string }>(
        "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '別校班') returning id",
        [ctx.orgId, fx.campusB, course!.id],
      )
    )[0]!.id;
    const allClasses = [...classes.map((c) => c.id), fx.other];
    await q(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status, teacher_id)
       select $1, c, $3, '18:00', '19:00', 'scheduled',
              (case when c = $4 then 'assigned' else 'unassigned' end)::session_assignment_status,
              case when c = $4 then $5::uuid end
         from unnest($2::uuid[]) c`,
      [ctx.orgId, allClasses, D, fx.mine, teacher!.id],
    );
    await q(
      `with e as (
         insert into events (org_id, event_type, title, event_date, start_time, end_time)
         select $1, 'session', s.id::text, s.session_date, s.start_time, s.end_time
           from sessions s where s.org_id = $1
         returning id, title)
       update sessions s set event_id = e.id from e where s.id::text = e.title`,
      [ctx.orgId],
    );
    // 每班 PER 個學生，都在籍、都點了出席
    await q(
      `with st as (
         insert into students (org_id, name, grade)
         select $1, '生 ' || c::text || '#' || k, 'J1'
           from unnest($2::uuid[]) c, generate_series(1, ${PER}) k
         returning id, name),
       en as (
         insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         select $1, split_part(substr(st.name, 3), '#', 1)::uuid, st.id, 'active', 'monthly', 1000, '2027-01-01'
           from st
         returning class_id, student_id)
       insert into attendance_records (org_id, event_id, student_id, status)
       select $1, s.event_id, en.student_id, 'present'
         from en join sessions s on s.class_id = en.class_id and s.org_id = $1`,
      [ctx.orgId, allClasses],
    );
    const [exam] = await q<{ id: string }>(
      "insert into academy_exams (org_id, campus_id, name, exam_date) values ($1, $2, '小考', $3) returning id",
      [ctx.orgId, fx.campusA, D],
    );
    await q('insert into academy_exam_classes (exam_id, class_id) values ($1, $2)', [
      exam!.id,
      fx.first,
    ]);
    app = (await import('../index')).default as never;
  }, 300_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from academy_exam_classes where exam_id in (select id from academy_exams where org_id = $1)',
      'delete from academy_exams where org_id = $1',
      'delete from attendance_records where org_id = $1',
      'update sessions set event_id = null where org_id = $1',
      'delete from events where org_id = $1',
      'delete from sessions where org_id = $1',
      'delete from enrollments where org_id = $1',
      'delete from students where org_id = $1',
      'delete from classes where org_id = $1',
      'delete from staff where org_id = $1',
      'delete from courses where org_id = $1',
      'delete from subjects where org_id = $1',
      'delete from campuses where org_id = $1',
      'delete from audit_logs where org_id = $1',
      'delete from organizations where id = $1',
    ]) {
      await q(sql, [ctx.orgId]);
    }
  }, 300_000);

  const as = (roles: string[], campusScope: string[] | null) => {
    ctx.roles = roles;
    ctx.campusScope = campusScope;
    ctx.failPool = false;
  };
  const workbench = async () => {
    const res = await app.request(`/api/workbench/today?date=${D}`, {}, env);
    return { status: res.status, body: (await res.json()) as { sessions: Summary[] } };
  };
  const expectCounts = (rows: Summary[]) => {
    for (const s of rows) {
      expect({ enrolled: s.enrolledCount, present: s.presentCount }).toEqual({
        enrolled: PER,
        present: PER,
      });
      expect(s.examCount).toBe(s.classId === fx.first ? 1 : 0);
    }
  };

  it(`不受限管理員：同一天 ${BIG + 1} 堂、${(BIG + 1) * PER} 筆出勤，每堂的在籍／出席／考試數都對`, async () => {
    as(['admin'], null);
    const { status, body } = await workbench();
    expect(status).toBe(200);
    expect(body.sessions).toHaveLength(BIG + 1);
    expectCounts(body.sessions);
  });

  it('受限管理員（只管 A 校）：看不到 B 校的班，A 校每堂計數都對', async () => {
    as(['admin'], [fx.campusA]);
    const { status, body } = await workbench();
    expect(status).toBe(200);
    expect(body.sessions).toHaveLength(BIG);
    expect(body.sessions.map((s) => s.classId)).not.toContain(fx.other);
    expectCounts(body.sessions);
  });

  it('老師：/attendance/sessions 只看到自己那堂，計數對', async () => {
    as(['teacher'], null);
    const res = await app.request(`/api/attendance/sessions?date=${D}&pageSize=100`, {}, env);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Summary[] };
    expect(data.map((s) => s.classId)).toEqual([fx.mine]);
    expectCounts(data);
  });

  it('計數讀取失敗 → 500，不回 0', async () => {
    as(['admin'], null);
    ctx.failPool = true;
    const res = await app.request(`/api/workbench/today?date=${D}`, {}, env);
    expect(res.status).toBe(500);
  });
});
