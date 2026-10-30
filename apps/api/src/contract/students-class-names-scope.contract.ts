import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { createServiceClientFromEnv } from '../lib/supabase';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

/**
 * **老師拿到的班名只有自己教的班**（計畫席 10-30，保留類：授權面），對真的本機 PostgREST 跑 ——
 * `classNames` 來自 `enrollments(classes(...))` 的 embed，替身看不出它有沒有縮。
 *
 * 一位學生 S 同時上兩個班：K（老師 A 教）、Y（老師 B 教）。原本 A 打 `GET /students` 會拿到
 * `classNames: [K, Y]`，老師學生頁照它分章，於是畫面上多出一章他沒教的班（本機 teacher0004 實測多 4 班）。
 * 守三件事：A 只有 K、B 只有 Y、管理員照舊兩個都有。班名（classNames）、班（classes[]，給學生面板查「這班」）、
 * 分校名（campusNames）三個欄位同一條規則 —— 只縮班名的話，分校名照樣講出他在別校上課（審核席 #2084 二讀）。
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

run('老師拿到的班名只有自己教的班（GET /students 的 classNames）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const START = shift(getCurrentTaipeiDateString(), -30);
  const fx = { userA: '', userB: '', student: '' };

  beforeAll(async () => {
    const users = await q<{ user_id: string }>(
      "select distinct user_id from user_roles where role = 'teacher' order by user_id limit 2",
    );
    [fx.userA, fx.userB] = users.map((u) => u.user_id) as [string, string];
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('契約：老師的班名範圍') returning id",
      )
    )[0]!.id;
    const one = async (sql: string, values: unknown[]) =>
      (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
    const campus = async (name: string) =>
      one('insert into campuses (org_id, name) values ($1, $2)', [ctx.orgId, name]);
    const campusA = await campus('A 的分校');
    const campusB = await campus('B 的分校');
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    const course = await one(
      'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
      [ctx.orgId, campusA, '數學', subject],
    );
    // 兩個班在不同分校：分校名也要跟著班一起縮（審核席 #2084 二讀）
    const klass = async (name: string, campusId: string) =>
      one('insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)', [
        ctx.orgId,
        campusId,
        course,
        name,
      ]);
    const k = await klass('A 教的班', campusA);
    const y = await klass('B 教的班', campusB);
    const staffA = await one(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, 'A')",
      [ctx.orgId, fx.userA],
    );
    const staffB = await one(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, 'B')",
      [ctx.orgId, fx.userB],
    );
    await q(
      `insert into schedules (class_id, weekday, start_time, end_time, teacher_id, effective_from)
       values ($1, 1, '18:00', '19:00', $2, $4), ($3, 2, '18:00', '19:00', $5, $4)`,
      [k, staffA, y, START, staffB],
    );
    fx.student = await one(
      "insert into students (org_id, name, grade) values ($1, '兩班都上', 'J2')",
      [ctx.orgId],
    );
    for (const cls of [k, y]) {
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, $4)`,
        [ctx.orgId, cls, fx.student, START],
      );
    }
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
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

  /** 這位學生在回應裡的班名、新的 classes[]（班名）、分校名，都排序過 */
  const seenAs = async (who: 'A' | 'B' | 'admin') => {
    ctx.role = who === 'admin' ? 'admin' : 'teacher';
    ctx.userId = who === 'B' ? fx.userB : fx.userA;
    const res = await app.request('/api/students?pageSize=50', undefined, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        id: string;
        classNames: string[];
        classes: Array<{ id: string; name: string }>;
        campusNames: string[];
      }>;
    };
    const row = body.data.find((s) => s.id === fx.student)!;
    return {
      classNames: row.classNames.slice().sort(),
      classes: row.classes.map((c) => c.name).sort(),
      campusNames: row.campusNames.slice().sort(),
    };
  };

  it('老師 A 只看得到自己教的班與它的分校；同一位學生在 B 的班、B 的分校都不出現', async () => {
    expect(await seenAs('A')).toEqual({
      classNames: ['A 教的班'],
      classes: ['A 教的班'],
      campusNames: ['A 的分校'],
    });
  });

  it('老師 B 同理，只有自己的班與分校', async () => {
    expect(await seenAs('B')).toEqual({
      classNames: ['B 教的班'],
      classes: ['B 教的班'],
      campusNames: ['B 的分校'],
    });
  });

  it('管理員照舊：兩個班、兩個分校都有', async () => {
    expect(await seenAs('admin')).toEqual({
      classNames: ['A 教的班', 'B 教的班'],
      classes: ['A 教的班', 'B 教的班'],
      campusNames: ['A 的分校', 'B 的分校'],
    });
  });
});
