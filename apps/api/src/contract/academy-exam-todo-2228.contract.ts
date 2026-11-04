import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2228：校內考待登錄的 N／M 在 DB 端撈齊、不吞錯**（保留類：授權範圍、分母口徑），對真的本機 Postgres 跑。
 *
 * 原本 `loadAcademyExamCounts` 三支 `.in()`：考試×班（`exam_id`，吞錯）、成績（`exam_id`，400）、
 * 報名（`class_id`，吞錯），而且成績／報名沒分頁、被 max_rows（1000）截斷。fixture：C1 有 FILLER 場
 * 已登完的 active 考試（同一班 4 人、成績 FILLER×4 筆 > 1000），外加一場「一筆都沒有」、一場「登到一半」；
 * C2 一場「一筆都沒有」。正確答案：不受限 none 2／partial 1，受限 C1 none 1／partial 1。
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

type Who = 'admin' | 'c1' | 'broken';
const ctx = { orgId: '', userId: '', who: 'admin' as Who, c1: '' };

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
      const query =
        ctx.who === 'broken'
          ? async () => {
              throw new Error('boom');
            }
          : pool!.query.bind(pool);
      set('supabase', supabase);
      set('orgId', ctx.orgId);
      set('userId', ctx.userId);
      set('roles', ['admin']);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', 'admin');
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', ctx.who === 'c1' ? [ctx.c1] : null);
      set('auth', { pool: { query, connect: pool!.connect.bind(pool), end: async () => {} } });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

const FILLER = 300;
/** 二校另有 MANY 場一筆都沒登的 —— 待登錄 id 整批塞進同一條 URL 的寫法會 414（審核席突變 ④） */
const MANY = 260;
const SEATS = 4;

run('#2228 校內考待登錄 N／M（todo-count、todo、todo-by-class）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { full: '', none: '', partial: '', other: '', bigClass: '', smallClass: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one(
      "insert into organizations (name) values ('#2228 契約：校內考待登錄')",
      [],
    );
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    ctx.c1 = await one("insert into campuses (org_id, name) values ($1, 'c1')", [ctx.orgId]);
    const c2 = await one("insert into campuses (org_id, name) values ($1, 'c2')", [ctx.orgId]);
    const course = async (campus: string, name: string) =>
      one('insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)', [
        ctx.orgId,
        campus,
        name,
        subject,
      ]);
    const cls = async (campus: string, name: string) =>
      one('insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)', [
        ctx.orgId,
        campus,
        await course(campus, name),
        name,
      ]);
    fx.bigClass = await cls(ctx.c1, '大班');
    fx.smallClass = await cls(ctx.c1, '小班');
    const otherClass = await cls(c2, '二校班');

    const students = async (classId: string, n: number) => {
      const ids = (
        await q<{ id: string }>(
          `insert into students (org_id, name, grade)
           select $1, '生 ' || n, 'J1' from generate_series(1, ${n}) n returning id`,
          [ctx.orgId],
        )
      ).map((r) => r.id);
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from, effective_to)
         select $1, $2, s, 'active'::enrollment_status, 'monthly', 1000, '2000-01-01', null
           from unnest($3::uuid[]) s`,
        [ctx.orgId, classId, ids],
      );
      return ids;
    };
    const big = await students(fx.bigClass, SEATS);
    const small = await students(fx.smallClass, 3);
    // 分母口徑（同 loadAcademyExamCounts）：作廢的不算、考試日還在籍的退班算、考完才轉入的不算
    const odd = (
      await q<{ id: string }>(
        `insert into students (org_id, name, grade)
         select $1, '異動 ' || n, 'J1' from generate_series(1, 4) n returning id`,
        [ctx.orgId],
      )
    ).map((r) => r.id);
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from, effective_to)
       values ($1, $2, $3, 'void', 'monthly', 1000, '2000-01-01', null),
              ($1, $2, $4, 'withdrawal', 'monthly', 1000, '2000-01-01', '2029-06-01'),
              ($1, $2, $5, 'active', 'monthly', 1000, '2029-06-02', null),
              ($1, $2, $6, 'active', 'monthly', 1000, '2029-06-05', null)`,
      [ctx.orgId, fx.smallClass, ...odd],
    );
    await students(otherClass, 2);

    const exam = async (campus: string, name: string, date: string, classId: string) => {
      const id = await one(
        `insert into academy_exams (org_id, campus_id, name, subject_id, exam_date, status)
         values ($1, $2, $3, $4, $5, 'active')`,
        [ctx.orgId, campus, name, subject, date],
      );
      await q('insert into academy_exam_classes (exam_id, class_id) values ($1, $2)', [
        id,
        classId,
      ]);
      return id;
    };
    // 已登完的 FILLER 場：同一個大班、每場 SEATS 筆 → 成績共 FILLER×SEATS 筆（> max_rows 1000）
    const fillers = (
      await q<{ id: string }>(
        `insert into academy_exams (org_id, campus_id, name, subject_id, exam_date, status)
         select $1, $2, '小考 ' || n, $3, date '2030-01-01' + n, 'active'
           from generate_series(1, ${FILLER}) n returning id`,
        [ctx.orgId, ctx.c1, subject],
      )
    ).map((r) => r.id);
    fx.full = fillers[0]!;
    await q(
      'insert into academy_exam_classes (exam_id, class_id) select e, $2 from unnest($1::uuid[]) e',
      [fillers, fx.bigClass],
    );
    await q(
      `insert into academy_scores (exam_id, student_id, score)
       select e, s, 80 from unnest($1::uuid[]) e cross join unnest($2::uuid[]) s`,
      [fillers, big],
    );
    fx.none = await exam(ctx.c1, '一筆都沒有', '2029-06-01', fx.smallClass);
    fx.partial = await exam(ctx.c1, '登到一半', '2029-06-02', fx.smallClass);
    await q('insert into academy_scores (exam_id, student_id, score) values ($1, $2, 70)', [
      fx.partial,
      small[0],
    ]);
    fx.other = await exam(c2, '二校沒登', '2029-06-03', otherClass);
    // 比上面幾場都舊（2028），所以新到舊排序下接在它們後面
    const many = (
      await q<{ id: string }>(
        `insert into academy_exams (org_id, campus_id, name, subject_id, exam_date, status)
         select $1, $2, '二校沒登 ' || n, $3, date '2028-12-31' - n, 'active'
           from generate_series(1, ${MANY}) n returning id`,
        [ctx.orgId, c2, subject],
      )
    ).map((r) => r.id);
    await q(
      'insert into academy_exam_classes (exam_id, class_id) select e, $2 from unnest($1::uuid[]) e',
      [many, otherClass],
    );
    app = (await import('../index')).default as never;
  }, 180_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
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

  const get = async (who: Who, path: string) => {
    ctx.who = who;
    try {
      return await app.request(`/api/academy-exams${path}`, {}, env);
    } finally {
      ctx.who = 'admin';
    }
  };
  const json = async <T>(who: Who, path: string) => {
    const res = await get(who, path);
    expect(res.status).toBe(200);
    return (await res.json()) as T;
  };
  type Counts = { count: number; none: number; partial: number };
  type List = { data: Array<{ id: string; expectedCount: number }>; meta: { total: number } };

  it(`todo-count：${FILLER + MANY + 3} 場 active、成績 ${FILLER * SEATS} 筆，只有真的沒登完的算`, async () => {
    expect(await json<Counts>('admin', '/todo-count')).toEqual({
      count: MANY + 3,
      none: MANY + 2,
      partial: 1,
    });
  });

  it('受限 C1：二校那場不算', async () => {
    expect(await json<Counts>('c1', '/todo-count')).toEqual({ count: 2, none: 1, partial: 1 });
  });

  it('列表 todo：total 跟 todo-count 對得上、分頁照考試日新到舊', async () => {
    // 待登錄 MANY＋3 場：舊寫法把全部待登錄 id 塞進主查詢的 URL → 414
    const p1 = await json<List>('admin', '?todo=true&pageSize=200');
    expect(p1.meta.total).toBe(MANY + 3);
    expect(p1.data).toHaveLength(200);
    expect(p1.data.slice(0, 3).map((r) => r.id)).toEqual([fx.other, fx.partial, fx.none]);
    // 小班 3 人＋退班當天（結束當天還算在籍）；作廢的、隔天才轉入的不算
    expect(p1.data[2]?.expectedCount).toBe(4);
    const p2 = await json<List>('admin', '?todo=true&pageSize=200&page=2');
    expect(p2.meta.total).toBe(MANY + 3);
    expect(p2.data).toHaveLength(MANY + 3 - 200);
    // 第 2 頁接得上：不重複、兩頁合起來就是全部待登錄
    const seen = new Set([...p1.data, ...p2.data].map((r) => r.id));
    expect(seen.size).toBe(MANY + 3);
  });

  it('列表 todo 受限 C1：候選集也收在範圍內（todoLevel 也一樣）', async () => {
    const all = await json<List>('c1', '?todo=true&pageSize=200');
    expect(all.meta.total).toBe(2);
    expect(all.data.map((r) => r.id)).toEqual([fx.partial, fx.none]);
    const none = await json<List>('c1', '?todo=true&todoLevel=none');
    expect(none.data.map((r) => r.id)).toEqual([fx.none]);
  });

  it('列表非 todo（pageSize 200）：分母照考試日在籍算', async () => {
    const page = await json<List>('c1', '?pageSize=200&order=date_asc');
    expect(page.data.find((r) => r.id === fx.full)?.expectedCount).toBe(SEATS);
  });

  it('todo-by-class：只列有待登錄的班，C1 小班兩場', async () => {
    const body = await json<{
      data: Array<{ classId: string; count: number; firstExamId: string }>;
    }>('c1', '/todo-by-class');
    expect(body.data).toEqual([{ classId: fx.smallClass, count: 2, firstExamId: fx.none }]);
  });

  it('N／M 查詢失敗 → 500，不吞成 0', async () => {
    expect((await get('broken', '/todo-count')).status).toBe(500);
    expect((await get('broken', '?todo=true')).status).toBe(500);
    expect((await get('broken', '/todo-by-class')).status).toBe(500);
    expect((await get('broken', '')).status).toBe(500);
  });
});
