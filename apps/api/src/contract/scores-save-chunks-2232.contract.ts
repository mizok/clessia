import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

/**
 * #2232 ②：存成績（校內考、學校段考）一次超過 ~200 位學生就 414，對真的本機 PostgREST＋Postgres 跑。
 *
 * 原本把 body 裡全部學生的 id 整串放進 `.in('id', …)`（確認學生屬於這個機構）—— 一所學校同年級的段考名冊
 * 上百人就 414。`scores` 也沒有上限。fixture：一個班 260 位學生、一場段考、一場校內考（考那個班）。
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
const N = 260;

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
      // 成績寫入走池（#1931）
      set('auth', {
        pool: {
          query: pool!.query.bind(pool),
          connect: pool!.connect.bind(pool),
          end: async () => undefined,
        },
      });
      await next();
    }),
  };
});

const BIG = 260;

run('存成績超過 200 位學生（#2232 ②）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (text: string, values: unknown[]) =>
    (await q<{ id: string }>(`${text} returning id`, values))[0]!.id;
  const fx = { subject: '', schoolExam: '', academyExam: '', students: [] as string[] };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one('insert into organizations (name) values ($1)', [
      '#2232 契約：存成績 260 位',
    ]);
    const campus = await one("insert into campuses (org_id, name) values ($1, '本校')", [
      ctx.orgId,
    ]);
    fx.subject = await one("insert into subjects (org_id, name) values ($1, '數學')", [ctx.orgId]);
    const course = await one(
      "insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, '數學', $3)",
      [ctx.orgId, campus, fx.subject],
    );
    const klass = await one(
      "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '班')",
      [ctx.orgId, campus, course],
    );
    const school = await one("insert into schools (org_id, name) values ($1, '某國中')", [
      ctx.orgId,
    ]);
    fx.students = (
      await q<{ id: string }>(
        `insert into students (org_id, name, grade, school_id)
         select $1, '學生 ' || n, 'J2', $2 from generate_series(1, ${N}) n returning id`,
        [ctx.orgId, school],
      )
    ).map((r) => r.id);
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       select $1, $2, unnest($3::uuid[]), 'active', 'monthly', 1000, '2026-01-01'`,
      [ctx.orgId, klass, fx.students],
    );
    fx.schoolExam = await one(
      `insert into school_exams (org_id, academic_year, semester, exam_type, label, exam_date, school_id)
       values ($1, 115, 1, 'term_exam', '#2232 段考', $2, $3)`,
      [ctx.orgId, getCurrentTaipeiDateString(), school],
    );
    fx.academyExam = await one(
      "insert into academy_exams (org_id, name, exam_date) values ($1, '#2232 小考', $2)",
      [ctx.orgId, getCurrentTaipeiDateString()],
    );
    await q('insert into academy_exam_classes (exam_id, class_id) values ($1, $2)', [
      fx.academyExam,
      klass,
    ]);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from school_scores where school_exam_id in (select id from school_exams where org_id = $1)',
      'delete from school_exams where org_id = $1',
      'delete from academy_scores where exam_id in (select id from academy_exams where org_id = $1)',
      'delete from academy_exam_classes where exam_id in (select id from academy_exams where org_id = $1)',
      'delete from academy_exams where org_id = $1',
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

  const post = (path: string, scores: unknown[]) =>
    app.request(
      path,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scores }),
      },
      env,
    );
  const ok = async (res: Response) => {
    if (res.status !== 200) throw new Error(`${res.status} ${await res.text()}`);
  };
  const count = async (sql: string, id: string) =>
    Number((await q<{ n: string }>(sql, [id]))[0]!.n);

  it('學校段考：一次存 260 位，全部進 DB', async () => {
    await ok(
      await post(
        `/api/school-exams/${fx.schoolExam}/scores`,
        fx.students.map((studentId) => ({
          studentId,
          subjectId: fx.subject,
          score: 80,
          status: 'scored',
        })),
      ),
    );
    expect(
      await count('select count(*) n from school_scores where school_exam_id = $1', fx.schoolExam),
    ).toBe(N);
  });

  it('校內考：一次存 260 位，全部進 DB', async () => {
    await ok(
      await post(
        `/api/academy-exams/${fx.academyExam}/scores`,
        fx.students.map((studentId) => ({ studentId, score: 80, status: 'scored' })),
      ),
    );
    expect(
      await count('select count(*) n from academy_scores where exam_id = $1', fx.academyExam),
    ).toBe(N);
  });

  it('scores 上限 2000：2001 列回 400（兩種考試）', async () => {
    const row = { studentId: fx.students[0], subjectId: fx.subject, score: 1, status: 'scored' };
    const many = Array.from({ length: 2001 }, () => row);
    expect((await post(`/api/school-exams/${fx.schoolExam}/scores`, many)).status).toBe(400);
    expect((await post(`/api/academy-exams/${fx.academyExam}/scores`, many)).status).toBe(400);
  });
});
