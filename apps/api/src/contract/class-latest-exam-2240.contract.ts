import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2240：班級列表的「最新考試」欄走 pg、不吞錯**，對真的本機 PostgREST／Postgres 跑。
 *
 * 原本 `loadLatestExams` 用三層 PostgREST `.in()`（links、enrollments 的 `class_id`，scores 的 `exam_id`）：
 * `GET /classes?pageSize=0` 班一多就 414，任一支失敗回 null → 路由整欄不回 `latestExam`、照樣 200。
 * fixture：BIG 個班都綁同一場考試，每班 1 個學生、分數 = 班號（另有一場較舊的考試綁第一班）；
 * 第一班另有作廢報名（不算）與退班（照算）的學生各一位。
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

const ctx = { orgId: '', userId: '', failExamSql: false };

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
      // 只讓「最新考試」那支 SQL 失敗（班級統計那支照常）—— 舊碼這欄不經 pool，所以失敗要靠新碼才看得到
      const query = async (text: string, values?: unknown[]) => {
        if (ctx.failExamSql && text.includes('academy_exam_classes')) throw new Error('boom');
        return pool!.query(text, values);
      };
      set('supabase', supabase);
      set('orgId', ctx.orgId);
      set('userId', ctx.userId);
      set('roles', ['admin']);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', 'admin');
      set('studentScope', null);
      set('campusScope', null);
      set('auth', { pool: { query, connect: pool!.connect.bind(pool), end: async () => {} } });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

const BIG = 260;

interface LatestExam {
  examId: string;
  avgScore: number | null;
}

run('#2240 班級列表的最新考試在 DB 端撈（GET /classes）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const fx = { exam: '', first: '', scoreByClass: new Map<string, number>() };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#2240 契約：最新考試') returning id",
      )
    )[0]!.id;
    const [campus] = await q<{ id: string }>(
      "insert into campuses (org_id, name) values ($1, '本校') returning id",
      [ctx.orgId],
    );
    const [subject] = await q<{ id: string }>(
      "insert into subjects (org_id, name) values ($1, '數學') returning id",
      [ctx.orgId],
    );
    const [course] = await q<{ id: string }>(
      "insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, '數學', $3) returning id",
      [ctx.orgId, campus!.id, subject!.id],
    );
    const classes = await q<{ id: string; n: number }>(
      `with c as (
         insert into classes (org_id, campus_id, course_id, name)
         select $1, $2, $3, '班 ' || lpad(n::text, 3, '0') from generate_series(1, ${BIG}) n
         returning id, name)
       select id, substr(name, 3)::int as n from c`,
      [ctx.orgId, campus!.id, course!.id],
    );
    fx.first = classes.find((c) => c.n === 1)!.id;
    const [older, latest] = await q<{ id: string }>(
      `insert into academy_exams (org_id, campus_id, name, exam_date)
       values ($1, $2, '舊考試', '2027-01-10'), ($1, $2, '月考', '2027-02-01') returning id`,
      [ctx.orgId, campus!.id],
    );
    fx.exam = latest!.id;
    await q(
      `insert into academy_exam_classes (exam_id, class_id)
       select $1::uuid, c from unnest($2::uuid[]) c union all select $3::uuid, $4::uuid`,
      [fx.exam, classes.map((c) => c.id), older!.id, fx.first],
    );
    // 每班一個學生、在籍、分數 = 班號
    await q(
      `with st as (
         insert into students (org_id, name, grade)
         select $1, c.id::text, 'J1' from classes c where c.org_id = $1
         returning id, name),
       en as (
         insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         select $1, st.name::uuid, st.id, 'active', 'monthly', 1000, '2027-01-01' from st
         returning class_id, student_id)
       insert into academy_scores (exam_id, student_id, score, status)
       select $2, en.student_id, substr(c.name, 3)::int, 'scored'
         from en join classes c on c.id = en.class_id`,
      [ctx.orgId, fx.exam],
    );
    for (const c of classes) fx.scoreByClass.set(c.id, c.n);
    // 第一班另兩位（審核席二讀）：作廢報名的分數不進平均（100 分，算進去平均就不是 2）；
    // 退班的照算（3 分）—— 同 academy-exam-roster 排除 void、保留退班。第一班 = (1 + 3) / 2
    await q(
      `with st as (
         insert into students (org_id, name, grade)
         values ($1, 'void', 'J1'), ($1, 'withdrawal', 'J1') returning id, name),
       en as (
         insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         select $1, $2, st.id, st.name::enrollment_status, 'monthly', 1000, '2027-01-01' from st
         returning student_id, status)
       insert into academy_scores (exam_id, student_id, score, status)
       select $3, en.student_id, case en.status when 'void' then 100 else 3 end, 'scored' from en`,
      [ctx.orgId, fx.first, fx.exam],
    );
    fx.scoreByClass.set(fx.first, 2);
    app = (await import('../index')).default as never;
  }, 300_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from academy_scores where exam_id in (select id from academy_exams where org_id = $1)',
      'delete from academy_exam_classes where exam_id in (select id from academy_exams where org_id = $1)',
      'delete from academy_exams where org_id = $1',
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

  it(`pageSize=0、${BIG} 個班：每班的 latestExam 都是最新那場、平均 = 該班學生的分數`, async () => {
    ctx.failExamSql = false;
    const res = await app.request('/api/classes?pageSize=0', {}, env);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: Array<{ id: string; latestExam?: LatestExam | null }>;
    };
    expect(data).toHaveLength(BIG);
    for (const row of data) {
      expect({ id: row.id, latestExam: row.latestExam }).toMatchObject({
        id: row.id,
        latestExam: { examId: fx.exam, avgScore: fx.scoreByClass.get(row.id) },
      });
    }
  });

  it('最新考試那支讀取失敗 → 500，不是整欄消失回 200', async () => {
    ctx.failExamSql = true;
    const res = await app.request('/api/classes?pageSize=0', {}, env);
    ctx.failExamSql = false;
    expect(res.status).toBe(500);
  });
});
