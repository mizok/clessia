// scope-contract: GET /api/school-exams
// scope-contract: GET /api/school-exams/:id/scores
// scope-contract: POST /api/school-exams/:id/scores
// scope-contract: GET /api/school-exams/:id/recent-students
// scope-contract: GET /api/school-exams/by-student/:studentId
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493 W5／R6：學校段考底下的每生成績看分校範圍**（保留類：授權範圍），對真的本機 PostgREST＋Postgres 跑。
 *
 * 段考目錄本身是機構層（ORG 帳本），漏的是底下的每生成績：受限管理員讀得到全機構學生的段考成績
 *（`/:id/scores`、`/:id/recent-students`、`/by-student/:studentId`）、列表 `scoreCount` 數全機構、
 * 寫得進別校學生的成績。裁定（11-13）：成績讀取收到範圍內學生；範圍外學生 404；寫入範圍外學生 403
 * STUDENT_OUT_OF_SCOPE（同 academy-exams）。
 *
 * fixture：學校 S；C1 的 A 班有 sA、C2 的 X 班有 sX，兩人都讀 S。段考 e（S）兩人各一筆成績。管理員只被指派 C1。
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
      set('auth', {
        pool: {
          query: pool!.query.bind(pool),
          connect: pool!.connect.bind(pool),
          end: async () => {},
        },
      });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

run('#2493 學校段考每生成績看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '', c2: '', subject: '', sA: '', sX: '', e: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one(
      "insert into organizations (name) values ('#2493 契約：段考成績範圍')",
      [],
    );
    fx.subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '國文',
    ]);
    fx.c1 = await one("insert into campuses (org_id, name) values ($1, 'C1')", [ctx.orgId]);
    fx.c2 = await one("insert into campuses (org_id, name) values ($1, 'C2')", [ctx.orgId]);
    const school = await one("insert into schools (org_id, name) values ($1, 'S 國中')", [
      ctx.orgId,
    ]);
    const student = async (campus: string, name: string) => {
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, `國文 ${name}`, fx.subject],
      );
      const klass = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, course, `班 ${name}`],
      );
      const id = await one(
        "insert into students (org_id, name, grade, school_id) values ($1, $2, 'J2', $3)",
        [ctx.orgId, name, school],
      );
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
        [ctx.orgId, klass, id],
      );
      return id;
    };
    fx.sA = await student(fx.c1, '甲生');
    fx.sX = await student(fx.c2, '乙生');
    fx.e = await one(
      `insert into school_exams (org_id, academic_year, semester, exam_type, label, exam_date, school_id, status)
       values ($1, 115, 1, 'term_exam', '期中', '2026-10-01', $2, 'active')`,
      [ctx.orgId, school],
    );
    for (const studentId of [fx.sA, fx.sX])
      await q(
        `insert into school_scores (school_exam_id, student_id, subject_id, score, status)
         values ($1, $2, $3, 70, 'scored')`,
        [fx.e, studentId, fx.subject],
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

  type Scope = 'all' | 'c1' | 'none';
  const call = async (scope: Scope, method: string, path: string, body?: unknown) => {
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx.c1] : [];
    try {
      return await app.request(
        `/api/school-exams${path}`,
        {
          method,
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        env,
      );
    } finally {
      ctx.campusScope = null;
    }
  };
  type Rows = { data: Array<Record<string, unknown>> };
  const json = async (scope: Scope, path: string) =>
    (await (await call(scope, 'GET', path)).json()) as Rows;
  const ids = (rows: Rows) => rows.data.map((r) => r['studentId']).sort();

  it('GET /:id/scores、/:id/recent-students：受限 C1 只看到 sA；空範圍 0 列；不受限兩位', async () => {
    for (const path of [`/${fx.e}/scores`, `/${fx.e}/recent-students`]) {
      expect(ids(await json('c1', path))).toEqual([fx.sA]);
      expect((await json('none', path)).data).toEqual([]);
      expect(ids(await json('all', path))).toEqual([fx.sA, fx.sX].sort());
    }
  });

  it('GET /：scoreCount 受限 C1 只數 1、空範圍 0、不受限 2（段考本身照列）', async () => {
    const countAs = async (scope: Scope) =>
      (await json(scope, '')).data.find((r) => r['id'] === fx.e)!['scoreCount'];
    expect(await countAs('c1')).toBe(1);
    expect(await countAs('none')).toBe(0);
    expect(await countAs('all')).toBe(2);
  });

  it('GET /by-student/:studentId：受限 C1 查 C2 學生 → 404；C1 學生照常', async () => {
    expect((await call('c1', 'GET', `/by-student/${fx.sX}`)).status).toBe(404);
    expect((await call('none', 'GET', `/by-student/${fx.sA}`)).status).toBe(404);
    expect((await call('c1', 'GET', `/by-student/${fx.sA}`)).status).toBe(200);
  });

  it('POST /:id/scores：受限 C1 寫 C2 學生 → 403 STUDENT_OUT_OF_SCOPE、分數不變；C1 學生照常', async () => {
    const save = (studentId: string, score: number) =>
      call('c1', 'POST', `/${fx.e}/scores`, {
        scores: [{ studentId, subjectId: fx.subject, score, status: 'scored' }],
      });
    const scoreOf = async (studentId: string) =>
      Number(
        (
          await q<{ score: string }>(
            'select score from school_scores where school_exam_id = $1 and student_id = $2',
            [fx.e, studentId],
          )
        )[0]!.score,
      );
    const out = await save(fx.sX, 1);
    expect(out.status).toBe(403);
    expect(await out.json()).toMatchObject({ code: 'STUDENT_OUT_OF_SCOPE' });
    expect(await scoreOf(fx.sX)).toBe(70);
    expect((await save(fx.sA, 88)).status).toBe(200);
    expect(await scoreOf(fx.sA)).toBe(88);
  });
});
