import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { createServiceClientFromEnv } from '../lib/supabase';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

/**
 * **老師學生面板的三支端點**（TST1，`kb/wiki/architecture/teacher-students-view.md`「學生面板」的守門測試），
 * 對真的本機 PostgREST 跑。面板不另做範圍，三份資料都靠既有端點守：
 *
 * 老師 A 教 K、老師 B 教 Y。S1 上 K 與 Y、S2 只上 Y；K、Y 各有一場校內考，S1 兩場都有分數。
 * - A 打 S2：`/students/{id}` 403、`attendance-days` 403、`/scores?studentId=S2` 空
 * - A 打 S1：讀得到；帶這班 K 的成績只有 K 的考試（面板就是這樣查的）。不帶班、帶別人的班時
 *   也看不到 Y 的考試 —— 那是成績端點本身的範圍，由 `scores-teacher-exam-scope` 守
 * （到班格「別人班的日子不出現」由 `students-attendance-days.spec.ts` 的老師那兩條守）
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
      set('permissions', []);
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

run('老師學生面板：三支端點只給老師自己教的班', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const TODAY = getCurrentTaipeiDateString();
  const START = shift(TODAY, -30);
  const fx = { userA: '', userB: '', s1: '', s2: '', k: '', y: '' };

  beforeAll(async () => {
    const users = await q<{ user_id: string }>(
      "select distinct user_id from user_roles where role = 'teacher' order by user_id limit 2",
    );
    [fx.userA, fx.userB] = users.map((u) => u.user_id) as [string, string];
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('契約：老師學生面板') returning id",
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
    const student = async (name: string) =>
      one("insert into students (org_id, name, grade) values ($1, $2, 'J2')", [ctx.orgId, name]);
    fx.s1 = await student('兩班都上');
    fx.s2 = await student('只上 B 的班');
    for (const [cls, sid] of [
      [fx.k, fx.s1],
      [fx.y, fx.s1],
      [fx.y, fx.s2],
    ]) {
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, $4)`,
        [ctx.orgId, cls, sid, START],
      );
    }
    for (const [cls, name] of [
      [fx.k, 'K 的小考'],
      [fx.y, 'Y 的小考'],
    ]) {
      const exam = await one(
        'insert into academy_exams (org_id, campus_id, name, exam_date) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, name, shift(TODAY, -3)],
      );
      await q('insert into academy_exam_classes (exam_id, class_id) values ($1, $2)', [exam, cls]);
      await q(
        "insert into academy_scores (exam_id, student_id, score, status) values ($1, $2, 80, 'scored')",
        [exam, fx.s1],
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

  const asA = (path: string) => {
    ctx.role = 'teacher';
    ctx.userId = fx.userA;
    return app.request(`/api${path}`, undefined, env);
  };
  const examNames = async (query: string) => {
    const res = await asA(`/scores?type=academy&${query}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ examName: string }> };
    return body.data.map((r) => r.examName).sort();
  };

  it('不是 A 的學生（S2）：詳情 403、到班格 403、成績空', async () => {
    expect((await asA(`/students/${fx.s2}`)).status).toBe(403);
    expect((await asA(`/students/${fx.s2}/attendance-days?from=${START}&to=${TODAY}`)).status).toBe(
      403,
    );
    expect(await examNames(`studentId=${fx.s2}`)).toEqual([]);
  });

  it('A 的學生（S1）：詳情與到班格讀得到', async () => {
    expect((await asA(`/students/${fx.s1}`)).status).toBe(200);
    expect((await asA(`/students/${fx.s1}/attendance-days?from=${START}&to=${TODAY}`)).status).toBe(
      200,
    );
  });

  it('S1 的成績：帶 K 只有 K 的考試', async () => {
    expect(await examNames(`studentId=${fx.s1}&classId=${fx.k}`)).toEqual(['K 的小考']);
  });
});
