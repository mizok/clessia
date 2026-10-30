import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { createServiceClientFromEnv } from '../lib/supabase';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

/**
 * **老師讀成績只看自己任課班的校內考**（保留類：授權面，計畫席 10-30），對真的本機 PostgREST＋Postgres 跑。
 *
 * 原本的老師範圍只縮「學生」：S1 也上別人的班 Y 時，老師 A 打成績端點會拿到 S1 在 Y 的校內考。
 * 四支讀成績的端點共用同一份「任課班的考試」範圍（`scores.ts` 的 `readableScope`），各守一條：
 * 列表 `GET /scores`、聚合 `GET /scores/students`、匯出 `POST /scores/export`、摘要 `GET /scores/student/{id}/summary`。
 * 管理員是對照組：同樣的請求兩場都看得到（確認斷言不是因為資料沒進去才通過）。
 * 最後一條守 414：範圍用班篩、不把任課班歷年的考試 id 塞進 URL。
 *
 * 學校段考（school）是學生層級、不屬於任何班，這裡不動也不測。
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

const ctx = { orgId: '', userId: '', role: 'teacher' as 'teacher' | 'admin' };

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
      set('roles', [ctx.role]);
      // 管理員對照組要打得到匯出（POST 走 requireAdminPermissionOnWrite）
      set('permissions', ctx.role === 'admin' ? ['basic_operations'] : []);
      set('activeRole', ctx.role);
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', null);
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

run('老師讀成績只看自己任課班的校內考', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = {
    ENVIRONMENT: 'contract',
    WEB_URL: 'http://localhost:4200',
    ALLOWED_ORIGINS: '',
    DATABASE_URL: DB,
    BETTER_AUTH_SECRET: 'contract-secret-contract-secret-32',
    BETTER_AUTH_URL: 'http://localhost:8787',
  };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const TODAY = getCurrentTaipeiDateString();
  const START = shift(TODAY, -30);
  const fx = { userA: '', userB: '', s1: '', k: '', y: '' };

  beforeAll(async () => {
    const users = await q<{ user_id: string }>(
      "select distinct user_id from user_roles where role = 'teacher' order by user_id limit 2",
    );
    [fx.userA, fx.userB] = users.map((u) => u.user_id) as [string, string];
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('契約：老師的成績範圍') returning id",
      )
    )[0]!.id;
    const one = async (sql: string, values: unknown[]) =>
      (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
    const campus = await one('insert into campuses (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '本校',
    ]);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    const course = await one(
      'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
      [ctx.orgId, campus, '數學', subject],
    );
    const klass = async (name: string) =>
      one('insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)', [
        ctx.orgId,
        campus,
        course,
        name,
      ]);
    fx.k = await klass('A 教的班');
    fx.y = await klass('B 教的班');
    const staff = async (userId: string, name: string) =>
      one('insert into staff (org_id, user_id, display_name) values ($1, $2, $3)', [
        ctx.orgId,
        userId,
        name,
      ]);
    const staffA = await staff(fx.userA, 'A');
    const staffB = await staff(fx.userB, 'B');
    await q(
      `insert into schedules (class_id, weekday, start_time, end_time, teacher_id, effective_from)
       values ($1, 1, '18:00', '19:00', $2, $4), ($3, 2, '18:00', '19:00', $5, $4)`,
      [fx.k, staffA, fx.y, START, staffB],
    );
    fx.s1 = await one("insert into students (org_id, name, grade) values ($1, $2, 'J2')", [
      ctx.orgId,
      '兩班都上',
    ]);
    for (const cls of [fx.k, fx.y]) {
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, $4)`,
        [ctx.orgId, cls, fx.s1, START],
      );
    }
    // K 的考 70 分、Y 的考 90 分：聚合與摘要的總分看得出有沒有混進 Y
    for (const [cls, name, score] of [
      [fx.k, 'K 的小考', 70],
      [fx.y, 'Y 的小考', 90],
    ] as const) {
      const exam = await one(
        'insert into academy_exams (org_id, campus_id, name, exam_date, subject_id) values ($1, $2, $3, $4, $5)',
        [ctx.orgId, campus, name, shift(TODAY, -3), subject],
      );
      await q('insert into academy_exam_classes (exam_id, class_id) values ($1, $2)', [exam, cls]);
      await q(
        "insert into academy_scores (exam_id, student_id, score, status) values ($1, $2, $3, 'scored')",
        [exam, fx.s1, score],
      );
    }
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

  const as = (who: 'A' | 'admin', path: string, init?: RequestInit) => {
    ctx.role = who === 'admin' ? 'admin' : 'teacher';
    ctx.userId = fx.userA;
    return app.request(`/api${path}`, init, env);
  };
  const json = async <T>(res: Response) => {
    expect(res.status).toBe(200);
    return (await res.json()) as T;
  };

  /** 列表：看得到哪幾場（排序過） */
  const listed = async (who: 'A' | 'admin', query: string) =>
    (
      await json<{ data: Array<{ examName: string }> }>(
        await as(who, `/scores?type=academy&studentId=${fx.s1}${query}`),
      )
    ).data
      .map((r) => r.examName)
      .sort();

  it('列表 GET /scores：A 不帶班、或帶 B 的班，都沒有 Y 的考試；管理員兩場都有', async () => {
    expect(await listed('A', '')).toEqual(['K 的小考']);
    expect(await listed('A', `&classId=${fx.y}`)).toEqual([]);
    expect(await listed('A', `&classId=${fx.k}`)).toEqual(['K 的小考']);
    expect(await listed('admin', '')).toEqual(['K 的小考', 'Y 的小考']);
  });

  it('聚合 GET /scores/students：A 的總分只有 K 的 70；管理員 160', async () => {
    const sum = async (who: 'A' | 'admin') =>
      (
        await json<{ data: Array<{ studentId: string; academySum: number | null }> }>(
          await as(who, `/scores/students?studentId=${fx.s1}`),
        )
      ).data.find((r) => r.studentId === fx.s1)?.academySum;
    expect(await sum('A')).toBe(70);
    expect(await sum('admin')).toBe(160);
  });

  it('匯出 POST /scores/export：A 的檔案沒有 Y 的考試；管理員兩場都有', async () => {
    const csv = async (who: 'A' | 'admin') => {
      const res = await as(who, '/scores/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentIds: [fx.s1] }),
      });
      expect(res.status).toBe(200);
      return res.text();
    };
    const a = await csv('A');
    expect(a).toContain('K 的小考');
    expect(a).not.toContain('Y 的小考');
    const admin = await csv('admin');
    expect(admin).toContain('K 的小考');
    expect(admin).toContain('Y 的小考');
  });

  it('摘要 GET /scores/student/{id}/summary：A 的科目總分只有 K 的 70；管理員 160', async () => {
    const sum = async (who: 'A' | 'admin') =>
      (
        await json<{
          data: { subjects: Array<{ subjectName: string; academySum: number | null }> };
        }>(await as(who, `/scores/student/${fx.s1}/summary`))
      ).data.subjects.find((s) => s.subjectName === '數學')?.academySum;
    expect(await sum('A')).toBe(70);
    expect(await sum('admin')).toBe(160);
  });
  // 計畫席 10-30 二讀：老師的範圍若用「考試 id」篩，歷年考試全塞進 GET URL，約 200 個 uuid 就 414。
  // 改用班篩之後，考試再多 URL 也只帶班 id。**放最後**：這裡加的 300 場會改變上面的總分
  it('老師的任課班有 300 場考試：列表、聚合、摘要都 200（不因考試 id 進 URL 而 414）', async () => {
    await q(
      `with e as (
         insert into academy_exams (org_id, name, exam_date)
         select $1, '大量 ' || g, $2::date - g from generate_series(1, 300) g
         returning id
       ), l as (
         insert into academy_exam_classes (exam_id, class_id) select id, $3 from e
       )
       insert into academy_scores (exam_id, student_id, score, status)
       select id, $4, 60, 'scored' from e`,
      [ctx.orgId, TODAY, fx.k, fx.s1],
    );
    for (const path of [
      `/scores?type=academy&studentId=${fx.s1}&pageSize=3`,
      `/scores/students?studentId=${fx.s1}`,
      `/scores/student/${fx.s1}/summary`,
    ]) {
      expect((await as('A', path)).status, path).toBe(200);
    }
  });
});
