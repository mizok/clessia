import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';
import { addDaysToDateString, getCurrentTaipeiDateString } from '../lib/taipei-date';

/**
 * **#1928：成績總覽不把窗內考試 id／班 id 塞進 URL**（保留類：分校範圍），對真的本機 PostgREST 跑。
 *
 * 原本先撈窗內全部校內考，再 `.in('exam_id', …)` 撈成績、`.in('class_id', …)` 撈報名：
 * 一個月兩百多場就 414，整頁 500。fixture：一校 260 班、每班一場窗內考試（2 人在籍、只登 1 人 → 每場都還沒登完），
 * 外加一場窗外的；二校 1 班 1 場登完。斷言不受限、受限一校、受限一校指名二校（403）、不受限指名二校四種範圍。
 * 「還沒登完」的場數要靠報名當分母 —— 報名那支漏了，這個數字會變 0。
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

const ctx = { orgId: '', adminUser: '', campusScope: null as string[] | null };

vi.mock('../middleware/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../middleware/auth')>();
  const { createMiddleware } = await import('hono/factory');
  return {
    ...original,
    authMiddleware: createMiddleware(async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set(
        'supabase',
        createServiceClientFromEnv({ SUPABASE_URL: URL!, SUPABASE_SECRET_KEY: KEY! } as never),
      );
      set('orgId', ctx.orgId);
      set('userId', ctx.adminUser);
      set('roles', ['admin']);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', 'admin');
      set('studentScope', null);
      set('campusScope', ctx.campusScope);
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

const BIG = 260;

run('#1928 成績總覽：窗內考試破 200 場不再 414', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const TODAY = getCurrentTaipeiDateString();
  const fx = { c1: '', c2: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.adminUser = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#1928 契約：成績總覽')", []);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    // 每次一門課、n 班；每班 2 位在籍、一場考試只登第 1 位（all 時兩位都登）。整批 unnest，不逐班往返
    let courseNo = 0;
    const seed = async (
      campus: string,
      n: number,
      examDate: (i: number) => string,
      all = false,
    ) => {
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, `數學 ${++courseNo}`, subject],
      );
      const ids = async (sql: string, values: unknown[]) =>
        (await q<{ id: string }>(`${sql} returning id`, values)).map((r) => r.id);
      const classes = await ids(
        `insert into classes (org_id, campus_id, course_id, name)
         select $1, $2, $3, '班 ' || i from generate_series(1, $4::int) i`,
        [ctx.orgId, campus, course, n],
      );
      const students = await ids(
        `insert into students (org_id, name, grade)
         select $1, '總覽生', 'J2' from generate_series(1, $2::int)`,
        [ctx.orgId, n * 2],
      );
      const pairClass = classes.flatMap((k) => [k, k]);
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         select $1, unnest($2::uuid[]), unnest($3::uuid[]), 'active', 'monthly', 1000, '2026-01-01'`,
        [ctx.orgId, pairClass, students],
      );
      const exams = await ids(
        `insert into academy_exams (org_id, campus_id, name, exam_date, subject_id)
         select $1, $2, '總覽小考 ' || i, d, $3 from unnest($4::date[]) with ordinality t(d, i)`,
        [ctx.orgId, campus, subject, classes.map((_, i) => examDate(i))],
      );
      await q(
        'insert into academy_exam_classes (exam_id, class_id) select unnest($1::uuid[]), unnest($2::uuid[])',
        [exams, classes],
      );
      const scored = classes.flatMap((_, i) =>
        all
          ? [
              [exams[i]!, students[i * 2]!],
              [exams[i]!, students[i * 2 + 1]!],
            ]
          : [[exams[i]!, students[i * 2]!]],
      );
      await q(
        `insert into academy_scores (exam_id, student_id, score, status)
         select unnest($1::uuid[]), unnest($2::uuid[]), 80, 'scored'`,
        [scored.map((r) => r[0]), scored.map((r) => r[1])],
      );
    };
    for (const key of ['c1', 'c2'] as const) {
      fx[key] = await one('insert into campuses (org_id, name) values ($1, $2)', [ctx.orgId, key]);
    }
    // 一校：260 班各一場，分散在窗內（今天、今天−1…今天−29）
    await seed(fx.c1, BIG, (i) => addDaysToDateString(TODAY, -(i % 30)));
    // 一校窗外一場（今天−31）：不進
    await seed(fx.c1, 1, () => addDaysToDateString(TODAY, -31));
    // 二校：1 班 1 場，登完
    await seed(fx.c2, 1, () => TODAY, true);
    app = (await import('../index')).default as never;
  }, 180_000);

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

  type Overview = {
    exams: { count: number; pendingCount: number; avgScore: number | null };
    totalClasses: number;
    recentExams: Array<{ examName: string }>;
  };
  const overview = async (scope: string[] | null, query = '') => {
    ctx.campusScope = scope;
    try {
      const res = await app.request(`/api/scores/overview${query}`, {}, env);
      expect(res.status).toBe(200);
      return (await res.json()) as Overview;
    } finally {
      ctx.campusScope = null;
    }
  };

  it('不受限的管理員：261 場（一校 260＋二校 1，窗外那場不進），一校 260 場都還沒登完', async () => {
    const body = await overview(null);
    expect(body.exams.count).toBe(BIG + 1);
    // 分母來自報名 —— 報名那支漏撈的話，這裡會是 0
    expect(body.exams.pendingCount).toBe(BIG);
    expect(body.totalClasses).toBe(BIG + 1);
    expect(body.exams.avgScore).toBe(80);
  });

  it('受限一校的管理員：只有一校 260 場，二校那場不進', async () => {
    const body = await overview([fx.c1]);
    expect(body.exams.count).toBe(BIG);
    expect(body.exams.pendingCount).toBe(BIG);
    expect(body.totalClasses).toBe(BIG);
  });

  it('受限一校指名二校：整條擋下（403），撐不大範圍', async () => {
    ctx.campusScope = [fx.c1];
    try {
      const res = await app.request(`/api/scores/overview?campusId=${fx.c2}`, {}, env);
      expect(res.status).toBe(403);
    } finally {
      ctx.campusScope = null;
    }
  });

  it('不受限指名二校：只有二校那場、已登完', async () => {
    const body = await overview(null, `?campusId=${fx.c2}`);
    expect(body.exams).toMatchObject({ count: 1, pendingCount: 0 });
  });
});
