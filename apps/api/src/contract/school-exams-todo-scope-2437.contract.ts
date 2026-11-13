import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2437：段考待登錄（`GET /school-exams?todo=true`、`/todo-count`）受分校範圍限制、不帶 id 清單**
 *（保留類：授權範圍），對真的本機 PostgREST 跑。
 *
 * 原本先撈全 org 的未結案段考 id 再 `.in('school_exam_id', …)` —— 兩百多場就 414，而且受限管理員
 * 看到的是全 org 的待登錄。裁定（11-12）：受限管理員只算自己分校範圍內的段考，且「範圍內學生
 * 0 筆成績」才算待登錄（別校登過不影響）。
 *
 * fixture：
 * - 學校 S1 學生只在 C1、S2 只在 C2、S3 有 a（C1）與 b（C2）
 * - e1＝S1 無成績、e2＝S2 無成績、e3＝S3 只有 b 登過、e4＝S3 只有 a 登過、closed＝S1 已結案無成績
 * - BIG 場 S1 無成績（破 200，舊碼 414）
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

run('#2437 段考待登錄受分校範圍限制、不帶 id 清單', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '', c2: '', e1: '', e2: '', e3: '', e4: '', closed: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2437 契約：段考待登錄')", []);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '國文',
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
    const school = (name: string) =>
      one('insert into schools (org_id, name) values ($1, $2)', [ctx.orgId, name]);
    const s1 = await school('#2437 一中');
    const s2 = await school('#2437 二中');
    const s3 = await school('#2437 三中');
    const student = async (schoolId: string, campus: 'c1' | 'c2') => {
      const id = await one(
        "insert into students (org_id, name, grade, school_id) values ($1, '生', 'J2', $2)",
        [ctx.orgId, schoolId],
      );
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
        [ctx.orgId, klass[campus], id],
      );
      return id;
    };
    await student(s1, 'c1');
    await student(s2, 'c2');
    const a = await student(s3, 'c1');
    const b = await student(s3, 'c2');
    const exam = (schoolId: string, label: string, status = 'active') =>
      one(
        `insert into school_exams (org_id, academic_year, semester, exam_type, label, exam_date, school_id, status)
         values ($1, 115, 1, 'term_exam', $2, '2026-10-01', $3, $4)`,
        [ctx.orgId, label, schoolId, status],
      );
    fx.e1 = await exam(s1, 'e1');
    fx.e2 = await exam(s2, 'e2');
    fx.e3 = await exam(s3, 'e3');
    fx.e4 = await exam(s3, 'e4');
    fx.closed = await exam(s1, 'closed', 'closed');
    const score = (examId: string, studentId: string) =>
      q(
        `insert into school_scores (school_exam_id, student_id, subject_id, score, status)
         values ($1, $2, $3, 70, 'scored')`,
        [examId, studentId, subject],
      );
    await score(fx.e3, b);
    await score(fx.e4, a);
    await q(
      `insert into school_exams (org_id, academic_year, semester, exam_type, label, exam_date, school_id)
       select $1, 115, 1, 'term_exam', 'big ' || n, '2026-09-01', $2 from generate_series(1, ${BIG}) n`,
      [ctx.orgId, s1],
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

  type List = { data: Array<{ id: string }>; meta: { total: number } };
  const as = async (scope: 'all' | 'c1' | 'c2' | 'none') => {
    ctx.campusScope = scope === 'all' ? null : scope === 'none' ? [] : [fx[scope]];
    try {
      const list = await app.request('/api/school-exams?todo=true&pageSize=200', {}, env);
      expect(list.status).toBe(200);
      const body = (await list.json()) as List;
      // 第 2 頁補齊 —— BIG 場加起來超過 pageSize 上限
      const page2 = await app.request('/api/school-exams?todo=true&pageSize=200&page=2', {}, env);
      expect(page2.status).toBe(200);
      const ids = [...body.data, ...((await page2.json()) as List).data].map((r) => r.id);
      const countRes = await app.request('/api/school-exams/todo-count', {}, env);
      expect(countRes.status).toBe(200);
      const { count } = (await countRes.json()) as { count: number };
      return { ids, total: body.meta.total, count };
    } finally {
      ctx.campusScope = null;
    }
  };

  it('跨分校：active 且 0 筆成績（e1、e2、BIG 場），e3／e4 有人登過、closed 不算；清單＝徽章', async () => {
    const r = await as('all');
    expect(r.total).toBe(BIG + 2);
    expect(r.count).toBe(BIG + 2);
    expect(r.ids).toHaveLength(BIG + 2);
    expect(r.ids).toEqual(expect.arrayContaining([fx.e1, fx.e2]));
    for (const id of [fx.e3, fx.e4, fx.closed]) expect(r.ids).not.toContain(id);
  });

  it('受限 C1：只有 C1 學生的學校；e3 只有 C2 的 b 登過仍算待登錄，e4 有 C1 的 a 登過不算', async () => {
    const r = await as('c1');
    expect(r.total).toBe(BIG + 2);
    expect(r.count).toBe(BIG + 2);
    expect(r.ids).toEqual(expect.arrayContaining([fx.e1, fx.e3]));
    for (const id of [fx.e2, fx.e4, fx.closed]) expect(r.ids).not.toContain(id);
  });

  it('受限 C2：只看到 e2、e4（看不到 C1 學校的 BIG 場）', async () => {
    const r = await as('c2');
    expect(r.total).toBe(2);
    expect(r.count).toBe(2);
    expect(r.ids.sort()).toEqual([fx.e2, fx.e4].sort());
  });

  it('一個分校都沒被指派：空（fail-closed）', async () => {
    const r = await as('none');
    expect(r).toEqual({ ids: [], total: 0, count: 0 });
  });
});
