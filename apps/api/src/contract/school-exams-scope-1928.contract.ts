import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

/**
 * **#1928 第 2 張：學校段考的分校範圍在 DB 端篩**（保留類：授權範圍），對真的本機 PostgREST 跑。
 *
 * 原本 GET /school-exams/{id} 與 /{id}/students 先撈「分校範圍內所有報名過的學生」（前置查詢沒分頁、
 * 一部分沒看 error），再 `.in('id', …)`／`.in('student_id', …)` 塞進 URL —— 一個分校兩三百位學生就 414：
 * 前者把錯誤吞成「範圍內沒人」回空摘要（200），後者 400。另外 GET /{id} **只有帶 campusId 或 grade
 * 才套分校範圍**，受限管理員什麼都不帶就拿到整個 org 的各科平均。
 *
 * fixture：同一所學校，C1 那班 260＋1 位（一位跨校 ab）、C2 一位只在二校 b；一場段考全員都有成績。
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

const ctx = { orgId: '', userId: '', campusScope: null as string[] | null };

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

const BIG = 260;

run('#1928 學校段考的分校範圍在 DB 端篩（GET /school-exams/{id}、/{id}/students）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '', c2: '', exam: '', ab: '', b: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#1928 契約：段考範圍')", []);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '國文',
    ]);
    const school = await one('insert into schools (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '#1928 國中',
    ]);
    const klass: Record<string, string> = {};
    for (const key of ['c1', 'c2'] as const) {
      fx[key] = await one('insert into campuses (org_id, name) values ($1, $2)', [ctx.orgId, key]);
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, fx[key], `國文 ${key}`, subject],
      );
      klass[key] = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, fx[key], course, `班 ${key}`],
      );
    }
    const enroll = (studentIds: string[], classId: string) =>
      q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         select $1, $2, unnest($3::uuid[]), 'active', 'monthly', 1000, '2026-01-01'`,
        [ctx.orgId, classId, studentIds],
      );
    const big = (
      await q<{ id: string }>(
        `insert into students (org_id, name, grade, school_id)
         select $1, '大分校生 ' || n, 'J2', $2 from generate_series(1, ${BIG}) n returning id`,
        [ctx.orgId, school],
      )
    ).map((r) => r.id);
    fx.ab = await one(
      "insert into students (org_id, name, grade, school_id) values ($1, '兩校都有', 'J2', $2)",
      [ctx.orgId, school],
    );
    fx.b = await one(
      "insert into students (org_id, name, grade, school_id) values ($1, '只在二校', 'J2', $2)",
      [ctx.orgId, school],
    );
    await enroll([...big, fx.ab], klass['c1']!);
    await enroll([fx.ab, fx.b], klass['c2']!);
    fx.exam = await one(
      `insert into school_exams (org_id, academic_year, semester, exam_type, label, exam_date, school_id)
       values ($1, 115, 1, 'term_exam', '#1928 段考', $2, $3)`,
      [ctx.orgId, getCurrentTaipeiDateString(), school],
    );
    await q(
      `insert into school_scores (school_exam_id, student_id, subject_id, score, status)
       select $1, unnest($2::uuid[]), $3, 70, 'scored'`,
      [fx.exam, [...big, fx.ab, fx.b], subject],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from school_scores where school_exam_id in (select id from school_exams where org_id = $1)',
      'delete from school_exams where org_id = $1',
      'delete from enrollments where org_id = $1',
      'delete from students where org_id = $1',
      'delete from schools where org_id = $1',
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

  const as = async <T>(scope: 'all' | 'c1', path: string) => {
    ctx.campusScope = scope === 'all' ? null : [fx.c1];
    try {
      const res = await app.request(`/api/school-exams/${fx.exam}${path}`, {}, env);
      expect(res.status).toBe(200);
      return (await res.json()) as T;
    } finally {
      ctx.campusScope = null;
    }
  };
  type Detail = { data: { summary: { totalRecordedCount: number } } };
  type Students = { data: Array<{ studentId: string }>; meta: { total: number } };
  const IN_C1 = BIG + 1;
  const recorded = (d: Detail) => d.data.summary.totalRecordedCount;

  it('GET /{id}：不受限的管理員看全部 262 筆；指名 C1 是 C1 的 261 筆（破 250 不再 414 成空摘要）', async () => {
    expect(recorded(await as<Detail>('all', ''))).toBe(IN_C1 + 1);
    expect(recorded(await as<Detail>('all', `?campusId=${fx.c1}`))).toBe(IN_C1);
    expect(recorded(await as<Detail>('all', `?campusId=${fx.c2}`))).toBe(2);
  });

  it('GET /{id}：受限 C1 什麼都不帶也只算 C1 的學生（原本不帶篩選就是整個 org）', async () => {
    expect(recorded(await as<Detail>('c1', ''))).toBe(IN_C1);
    expect(recorded(await as<Detail>('c1', '?grade=J2'))).toBe(IN_C1);
  });

  it('GET /{id}/students：受限 C1 是 261 位、沒有只在二校的 b；不受限 262 位', async () => {
    expect((await as<Students>('c1', '/students?pageSize=1')).meta.total).toBe(IN_C1);
    const b = await as<Students>('c1', `/students?search=${encodeURIComponent('只在二校')}`);
    expect(b.meta.total).toBe(0);
    const ab = await as<Students>('c1', `/students?search=${encodeURIComponent('兩校都有')}`);
    expect(ab.data.map((r) => r.studentId)).toEqual([fx.ab]);
    expect((await as<Students>('all', '/students?pageSize=1')).meta.total).toBe(IN_C1 + 1);
    expect((await as<Students>('all', `/students?campusId=${fx.c2}&pageSize=1`)).meta.total).toBe(
      2,
    );
  });
});
