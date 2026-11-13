// scope-contract: GET /api/academy-exams/:id
// scope-contract: GET /api/academy-exams/:id/scores
// scope-contract: POST /api/academy-exams
// scope-contract: PUT /api/academy-exams/:id
// scope-contract: DELETE /api/academy-exams/:id
// scope-contract: PATCH /api/academy-exams/:id/close
// scope-contract: PATCH /api/academy-exams/:id/reopen
// scope-contract: POST /api/academy-exams/:id/scores
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493 W4／R5：校內考的單筆讀、改、刪、關、開、讀寫成績看分校範圍**（保留類：授權範圍），
 * 對真的本機 PostgREST＋Postgres 跑。
 *
 * 原本 `examInScope` 對管理員一律放行、`ensureExamOwnedByOrg`／`ensureClassesInOrg` 只看 org：
 * 受限管理員用 id 就讀得到別校考試與整份成績、改刪關開得了別校考試、開得出掛別校班的考試
 *（等於一條讀別校成績的管道）、對範圍內考試寫得進別校學生的成績。
 * 裁定（11-13）：範圍外＝404 不寫；受限者不能開全機構考試（campusId 省略／null → 403）；
 * 範圍外學生的成績 → 403 STUDENT_OUT_OF_SCOPE。
 *
 * fixture：C1 有 A 班（學生 sA）、C2 有 X 班（學生 sX）。考試 eA（C1、A 班）、eX（C2、X 班）、
 * eXc（C2、已關）、eDel（C2、給刪除用）、eNull（全機構、A 班）。管理員只被指派 C1。
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

run('#2493 校內考看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = {
    c1: '',
    c2: '',
    a: '',
    x: '',
    sA: '',
    sX: '',
    eA: '',
    eX: '',
    eXc: '',
    eDel: '',
    eNull: '',
  };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：校內考範圍')", []);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    const klass = async (campus: string, name: string) => {
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, `數學 ${name}`, subject],
      );
      return one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, course, name],
      );
    };
    fx.c1 = await one("insert into campuses (org_id, name) values ($1, 'C1')", [ctx.orgId]);
    fx.c2 = await one("insert into campuses (org_id, name) values ($1, 'C2')", [ctx.orgId]);
    fx.a = await klass(fx.c1, 'A');
    fx.x = await klass(fx.c2, 'X');
    const student = async (classId: string, name: string) => {
      const id = await one("insert into students (org_id, name, grade) values ($1, $2, 'J2')", [
        ctx.orgId,
        name,
      ]);
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
        [ctx.orgId, classId, id],
      );
      return id;
    };
    fx.sA = await student(fx.a, '甲');
    fx.sX = await student(fx.x, '乙');
    const exam = async (campus: string | null, classId: string, status: string) => {
      const id = await one(
        `insert into academy_exams (org_id, campus_id, name, exam_date, status)
         values ($1, $2, '小考', '2026-10-01', $3)`,
        [ctx.orgId, campus, status],
      );
      await q('insert into academy_exam_classes (exam_id, class_id) values ($1, $2)', [
        id,
        classId,
      ]);
      return id;
    };
    fx.eA = await exam(fx.c1, fx.a, 'active');
    fx.eX = await exam(fx.c2, fx.x, 'active');
    fx.eXc = await exam(fx.c2, fx.x, 'closed');
    fx.eDel = await exam(fx.c2, fx.x, 'active');
    fx.eNull = await exam(null, fx.a, 'active');
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from academy_scores where exam_id in (select id from academy_exams where org_id = $1)',
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
  }, 120_000);

  type Scope = 'all' | 'c1' | 'none';
  const call = async (scope: Scope, method: string, path: string, body?: unknown) => {
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx.c1] : [];
    try {
      return await app.request(
        `/api/academy-exams${path}`,
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
  const exam = async (id: string) =>
    (
      await q<{ name: string; status: string }>(
        'select name, status from academy_exams where id = $1',
        [id],
      )
    )[0];
  const scoreCount = async (examId: string) =>
    Number(
      (
        await q<{ n: string }>('select count(*) n from academy_scores where exam_id = $1', [examId])
      )[0]!.n,
    );
  const examCount = async () =>
    Number(
      (
        await q<{ n: string }>('select count(*) n from academy_exams where org_id = $1', [
          ctx.orgId,
        ])
      )[0]!.n,
    );

  it('GET /:id、/:id/scores：受限 C1 讀 C2 與全機構考試 → 404；空範圍連 C1 也讀不到；C1 照常', async () => {
    expect((await call('c1', 'GET', `/${fx.eX}`)).status).toBe(404);
    expect((await call('c1', 'GET', `/${fx.eNull}`)).status).toBe(404);
    expect((await call('c1', 'GET', `/${fx.eX}/scores`)).status).toBe(404);
    expect((await call('none', 'GET', `/${fx.eA}`)).status).toBe(404);
    expect((await call('c1', 'GET', `/${fx.eA}`)).status).toBe(200);
    expect((await call('c1', 'GET', `/${fx.eA}/scores`)).status).toBe(200);
    expect((await call('all', 'GET', `/${fx.eX}`)).status).toBe(200);
  });

  it('POST /：受限 C1 掛 C2 的班 → 400、沒建；不帶分校 → 403、沒建；C1＋A 班 → 201', async () => {
    const base = { name: '契約考', examType: 'quiz', examDate: '2026-10-02' };
    const before = await examCount();
    expect(
      (await call('c1', 'POST', '', { ...base, campusId: fx.c1, classIds: [fx.x] })).status,
    ).toBe(400);
    expect((await call('c1', 'POST', '', { ...base, classIds: [fx.a] })).status).toBe(403);
    expect(
      (await call('c1', 'POST', '', { ...base, campusId: null, classIds: [fx.a] })).status,
    ).toBe(403);
    expect(await examCount()).toBe(before);
    expect(
      (await call('c1', 'POST', '', { ...base, campusId: fx.c1, classIds: [fx.a] })).status,
    ).toBe(201);
  });

  it('PUT /:id：受限 C1 改 C2 的考試 → 404 不變；把 C1 考試掛 C2 班 → 400；改成全機構 → 403；C1 照常', async () => {
    expect((await call('c1', 'PUT', `/${fx.eX}`, { name: '偷改' })).status).toBe(404);
    expect((await exam(fx.eX))!.name).toBe('小考');
    expect((await call('c1', 'PUT', `/${fx.eA}`, { classIds: [fx.x] })).status).toBe(400);
    expect((await call('c1', 'PUT', `/${fx.eA}`, { campusId: null })).status).toBe(403);
    expect((await call('c1', 'PUT', `/${fx.eA}`, { name: '期中小考' })).status).toBe(200);
    expect((await exam(fx.eA))!.name).toBe('期中小考');
  });

  it('DELETE、close、reopen：受限 C1 對 C2 的考試 → 404、狀態不變；不受限照常', async () => {
    expect((await call('c1', 'DELETE', `/${fx.eDel}`)).status).toBe(404);
    expect(await exam(fx.eDel)).toBeDefined();
    expect((await call('c1', 'PATCH', `/${fx.eX}/close`)).status).toBe(404);
    expect((await exam(fx.eX))!.status).toBe('active');
    expect((await call('c1', 'PATCH', `/${fx.eXc}/reopen`)).status).toBe(404);
    expect((await exam(fx.eXc))!.status).toBe('closed');
    expect((await call('all', 'DELETE', `/${fx.eDel}`)).status).toBe(200);
    expect(await exam(fx.eDel)).toBeUndefined();
  });

  it('POST /:id/scores：受限 C1 寫 C2 考試 → 404；在 C1 考試寫 C2 學生 → 403；都不寫；C1 學生照常', async () => {
    const save = (scope: Scope, examId: string, studentId: string) =>
      call(scope, 'POST', `/${examId}/scores`, {
        scores: [{ studentId, score: 80, status: 'scored' }],
      });
    expect((await save('c1', fx.eX, fx.sX)).status).toBe(404);
    expect(await scoreCount(fx.eX)).toBe(0);
    const cross = await save('c1', fx.eA, fx.sX);
    expect(cross.status).toBe(403);
    expect(await cross.json()).toMatchObject({ code: 'STUDENT_OUT_OF_SCOPE' });
    expect(await scoreCount(fx.eA)).toBe(0);
    expect((await save('c1', fx.eA, fx.sA)).status).toBe(200);
    expect(await scoreCount(fx.eA)).toBe(1);
  });
});
