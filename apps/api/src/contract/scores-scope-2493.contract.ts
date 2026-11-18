// scope-contract: POST /api/scores/export
// scope-contract: GET /api/scores/student/:studentId/summary
// scope-contract: GET /api/scores/class/:classId/exam/:examId
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

/**
 * **#2493 上半：成績匯出、學生摘要、單班單考的分校範圍契約認領**（保留類：授權範圍），
 * 對真的本機 PostgREST＋Postgres 跑。盤點時範圍已 OK，這裡把它釘住。
 *
 * fixture：C1、C2 各一班一生；C2 那班有一場校內考（二校生 88 分）。管理員只被指派 C1。
 * 受限 C1：匯出不含二校生（指名 C2 也撐不大）；摘要讀二校生 403；讀 C2 班的考試 403。不受限照常。
 * 同 route 的列表、聚合、總覽已由 scores-scope-1928／scores-overview-1928 認領。
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

run('#2493 成績匯出、摘要、單班單考看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { c1: '', c2: '', class2: '', s2: '', exam: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：成績範圍')", []);
    const subject = await one("insert into subjects (org_id, name) values ($1, '數學')", [
      ctx.orgId,
    ]);
    const today = getCurrentTaipeiDateString();
    for (const key of ['1', '2'] as const) {
      const campus = await one('insert into campuses (org_id, name) values ($1, $2)', [
        ctx.orgId,
        `C${key}`,
      ]);
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, `數學 C${key}`, subject],
      );
      const klass = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, course, `班 C${key}`],
      );
      const student = await one(
        "insert into students (org_id, name, grade) values ($1, $2, 'J2')",
        [ctx.orgId, key === '1' ? '一校生' : '二校生'],
      );
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
        [ctx.orgId, klass, student],
      );
      if (key === '1') fx.c1 = campus;
      else Object.assign(fx, { c2: campus, class2: klass, s2: student });
    }
    fx.exam = await one(
      'insert into academy_exams (org_id, campus_id, name, exam_date, subject_id) values ($1, $2, $3, $4, $5)',
      [ctx.orgId, fx.c2, '二校小考', today, subject],
    );
    await q('insert into academy_exam_classes (exam_id, class_id) values ($1, $2)', [
      fx.exam,
      fx.class2,
    ]);
    await q(
      "insert into academy_scores (exam_id, student_id, score, status) values ($1, $2, 88, 'scored')",
      [fx.exam, fx.s2],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

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
  }, 120_000);

  const call = async (scope: 'all' | 'c1', path: string, body?: unknown) => {
    ctx.campusScope = scope === 'all' ? null : [fx.c1];
    try {
      return await app.request(
        `/api/scores${path}`,
        body === undefined
          ? undefined
          : {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            },
        env,
      );
    } finally {
      ctx.campusScope = null;
    }
  };

  it('POST /export：受限 C1 的檔案沒有二校生，指名 C2 也撐不大（取交集）；不受限有', async () => {
    const csv = async (scope: 'all' | 'c1', body: unknown) => {
      const res = await call(scope, '/export', body);
      expect(res.status).toBe(200);
      return res.text();
    };
    expect(await csv('c1', {})).not.toContain('二校生');
    expect(await csv('c1', { campusId: fx.c2 })).not.toContain('二校生');
    expect(await csv('all', {})).toContain('二校生');
  });

  it('GET /student/:id/summary：受限 C1 讀二校生 → 403；不受限 200', async () => {
    const out = await call('c1', `/student/${fx.s2}/summary`);
    expect(out.status).toBe(403);
    expect(JSON.stringify(await out.json())).not.toContain('88');
    expect((await call('all', `/student/${fx.s2}/summary`)).status).toBe(200);
  });

  it('GET /class/:classId/exam/:examId：受限 C1 讀 C2 班 → 403、不吐分數；不受限 200 有分數', async () => {
    const path = `/class/${fx.class2}/exam/${fx.exam}`;
    const out = await call('c1', path);
    expect(out.status).toBe(403);
    expect(JSON.stringify(await out.json())).not.toContain('二校生');
    const ok = await call('all', path);
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).toContain('二校生');
  });
});
