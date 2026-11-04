import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#1928 第 3 張：學生列表的範圍在 DB 端篩**（保留類：授權範圍），對真的本機 PostgREST 跑。
 *
 * 原本 GET /students 先撈範圍內的學生 id —— 受限管理員：分校範圍內所有報名過的（前置查詢沒分頁、沒看 error）；
 * 老師：任課班在籍的 —— 再 `.in('id', …)` 塞進 URL，兩三百位就 414，整頁 500；在籍數那支還把錯誤吞成 0。
 * fixture：C1 那班 260＋1 位（一位跨校 ab）、C2 一位只在二校 b；老師只教 C1 那班。
 * 另一位 w：C1 那班已退班（withdrawal）、C2 那班在籍 —— 老師看不到（任課的條件是「同一筆報名」的班＋在籍狀態），
 * 受限 C1 的管理員看得到（分校範圍是任一報名、不分狀態，enrollment-rules 第 8 節）。
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

type Who = 'admin' | 'c1' | 'teacher';
const ctx = { orgId: '', adminUser: '', teacherUser: '', who: 'admin' as Who, c1: '' };

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
      const teacher = ctx.who === 'teacher';
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', supabase);
      set('orgId', ctx.orgId);
      set('userId', teacher ? ctx.teacherUser : ctx.adminUser);
      set('roles', [teacher ? 'teacher' : 'admin']);
      set('permissions', teacher ? [] : [...PERMISSIONS]);
      set('activeRole', teacher ? 'teacher' : 'admin');
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', ctx.who === 'c1' ? [ctx.c1] : null);
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

const BIG = 260;

run('#1928 學生列表的範圍在 DB 端篩（GET /students）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { ab: '', b: '', w: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    const [teacher] = await q<{ user_id: string }>(
      `select r.user_id from user_roles r where r.role = 'teacher'
         and not exists (select 1 from user_roles a where a.user_id = r.user_id and a.role = 'admin')
       order by r.user_id limit 1`,
    );
    ctx.adminUser = admin!.user_id;
    ctx.teacherUser = teacher!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#1928 契約：學生範圍')", []);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '英文',
    ]);
    const klass: Record<string, string> = {};
    for (const key of ['c1', 'c2'] as const) {
      const campus = await one('insert into campuses (org_id, name) values ($1, $2)', [
        ctx.orgId,
        key,
      ]);
      if (key === 'c1') ctx.c1 = campus;
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, `英文 ${key}`, subject],
      );
      klass[key] = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, course, `班 ${key}`],
      );
    }
    const staff = await one(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '一校老師')",
      [ctx.orgId, ctx.teacherUser],
    );
    await q(
      `insert into schedules (class_id, weekday, start_time, end_time, teacher_id, effective_from)
       values ($1, 1, '18:00', '19:00', $2, '2026-01-01')`,
      [klass['c1'], staff],
    );
    const enroll = (studentIds: string[], classId: string, status = 'active') =>
      q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         select $1, $2, unnest($3::uuid[]), $4::enrollment_status, 'monthly', 1000, '2026-01-01'`,
        [ctx.orgId, classId, studentIds, status],
      );
    const big = (
      await q<{ id: string }>(
        `insert into students (org_id, name, grade)
         select $1, '大分校生 ' || n, 'J2' from generate_series(1, ${BIG}) n returning id`,
        [ctx.orgId],
      )
    ).map((r) => r.id);
    fx.ab = await one("insert into students (org_id, name, grade) values ($1, '兩校都有', 'J3')", [
      ctx.orgId,
    ]);
    fx.b = await one("insert into students (org_id, name, grade) values ($1, '只在二校', 'J1')", [
      ctx.orgId,
    ]);
    fx.w = await one("insert into students (org_id, name, grade) values ($1, '一校退班', 'S1')", [
      ctx.orgId,
    ]);
    await enroll([...big, fx.ab], klass['c1']!);
    await enroll([fx.w], klass['c1']!, 'withdrawal');
    await enroll([fx.ab, fx.b, fx.w], klass['c2']!);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from enrollments where org_id = $1',
      'delete from students where org_id = $1',
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

  type Body = {
    data: Array<{ id: string; name: string }>;
    summary: {
      total: number;
      activeCount: number;
      byGrade: Array<{ grade: string; count: number }>;
    };
  };
  const list = async (who: Who, qs = '') => {
    ctx.who = who;
    try {
      const res = await app.request(`/api/students?withToday=false${qs}`, {}, env);
      expect(res.status).toBe(200);
      return (await res.json()) as Body;
    } finally {
      ctx.who = 'admin';
    }
  };
  const grades = (b: Body) =>
    Object.fromEntries(b.summary.byGrade.filter((g) => g.count > 0).map((g) => [g.grade, g.count]));
  const IN_C1 = BIG + 1;

  it('不受限的管理員：263 位，章節 J2 260、J3 1、J1 1、S1 1', async () => {
    const b = await list('admin');
    expect(b.summary.total).toBe(IN_C1 + 2);
    expect(b.summary.activeCount).toBe(IN_C1 + 2);
    expect(grades(b)).toEqual({ J2: BIG, J3: 1, J1: 1, S1: 1 });
  });

  it('受限 C1 的管理員：破 250 也照樣 200；總數、在籍數、章節都是 C1 的 262 位（含 C1 已退班的 w）', async () => {
    const b = await list('c1');
    expect(b.summary.total).toBe(IN_C1 + 1);
    expect(b.summary.activeCount).toBe(IN_C1 + 1);
    expect(grades(b)).toEqual({ J2: BIG, J3: 1, S1: 1 });
    expect((await list('c1', `&search=${encodeURIComponent('一校退班')}`)).summary.total).toBe(1);
    expect((await list('c1', `&search=${encodeURIComponent('只在二校')}`)).summary.total).toBe(0);
  });

  it('老師（只教 C1 那班）：破 250 也照樣 200；只有任課班在籍的 261 位（C1 退班、C2 在籍的 w 不算）', async () => {
    const b = await list('teacher');
    expect(b.summary.total).toBe(IN_C1);
    expect(b.summary.activeCount).toBe(IN_C1);
    expect(grades(b)).toEqual({ J2: BIG, J3: 1 });
    expect((await list('teacher', `&search=${encodeURIComponent('一校退班')}`)).summary.total).toBe(
      0,
    );
    expect((await list('teacher', `&search=${encodeURIComponent('只在二校')}`)).summary.total).toBe(
      0,
    );
  });
});
