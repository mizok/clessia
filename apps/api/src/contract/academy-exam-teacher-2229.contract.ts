import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

/**
 * **#2229：老師的校內考列表範圍在 DB 端篩（embed）、不吞錯**（保留類：授權範圍），對真的本機 PostgREST 跑。
 *
 * 原本先撈「現任＋歷任班的歷年考試 id」（不看 error），再 `.in('id', 全部)` 塞回主查詢 —— 隨年資累積必 414。
 * fixture：老師 A 現任「現任班」（FILLER 場考試，都登完）、前任「換手班」（任期內一場 BEFORE、卸任後一場
 * AFTER，都沒登）；老師 B 的「別人班」一場；二校一班一場。A 看得到 FILLER＋1 場。
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

type Who = 'teacherA' | 'admin' | 'c1';
const ctx = { orgId: '', who: 'teacherA' as Who, userA: '', admin: '', c1: '' };

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
      const isTeacher = ctx.who === 'teacherA';
      set('supabase', supabase);
      set('orgId', ctx.orgId);
      set('userId', isTeacher ? ctx.userA : ctx.admin);
      set('roles', [isTeacher ? 'teacher' : 'admin']);
      set('permissions', isTeacher ? [] : [...PERMISSIONS]);
      set('activeRole', isTeacher ? 'teacher' : 'admin');
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', ctx.who === 'c1' ? [ctx.c1] : null);
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

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const FILLER = 260;

run('#2229 老師的校內考列表（現任＋前任任期）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const TODAY = getCurrentTaipeiDateString();
  const X = shift(TODAY, -15);
  const fx = {
    cur: '',
    past: '',
    others: '',
    c2: '',
    before: '',
    after: '',
    other: '',
    c2exam: '',
  };

  beforeAll(async () => {
    const [teacherA, teacherB] = (
      await q<{ user_id: string }>(
        "select distinct user_id from user_roles where role = 'teacher' order by user_id limit 2",
      )
    ).map((u) => u.user_id) as [string, string];
    ctx.userA = teacherA;
    ctx.admin = (
      await q<{ user_id: string }>(
        "select user_id from user_roles where role = 'admin' order by user_id limit 1",
      )
    )[0]!.user_id;
    ctx.orgId = await one(
      "insert into organizations (name) values ('#2229 契約：老師考試列表')",
      [],
    );
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    ctx.c1 = await one("insert into campuses (org_id, name) values ($1, 'c1')", [ctx.orgId]);
    const c2 = await one("insert into campuses (org_id, name) values ($1, 'c2')", [ctx.orgId]);
    const cls = async (campus: string, name: string) =>
      one('insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)', [
        ctx.orgId,
        campus,
        await one(
          'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
          [ctx.orgId, campus, name, subject],
        ),
        name,
      ]);
    fx.cur = await cls(ctx.c1, '現任班');
    fx.past = await cls(ctx.c1, '換手班');
    fx.others = await cls(ctx.c1, '別人班');
    fx.c2 = await cls(c2, '二校班');
    const staffA = await one(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '老師 A')",
      [ctx.orgId, teacherA],
    );
    const staffB = await one(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '老師 B')",
      [ctx.orgId, teacherB],
    );
    const begin = shift(TODAY, -400);
    await q(
      `insert into schedules (class_id, weekday, start_time, end_time, teacher_id, effective_from, effective_to)
       values ($1, 1, '18:00', '19:00', $2, $3, null),
              ($4, 2, '18:00', '19:00', $2, $3, $5),
              ($4, 2, '18:00', '19:00', $6, $7, null),
              ($8, 3, '18:00', '19:00', $6, $3, null),
              ($9, 4, '18:00', '19:00', $6, $3, null)`,
      [fx.cur, staffA, begin, fx.past, shift(X, -1), staffB, X, fx.others, fx.c2],
    );
    const student = await one(
      "insert into students (org_id, name, grade) values ($1, '生', 'J1')",
      [ctx.orgId],
    );
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       select $1, k, $2, 'active', 'monthly', 1000, $3 from unnest($4::uuid[]) k`,
      [ctx.orgId, student, begin, [fx.cur, fx.past, fx.others, fx.c2]],
    );
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
    // 現任班 FILLER 場、都登完（todo 不算）
    const fillers = (
      await q<{ id: string }>(
        `insert into academy_exams (org_id, campus_id, name, subject_id, exam_date, status)
         select $1, $2, '小考 ' || n, $3, $4::date - n, 'active'
           from generate_series(1, ${FILLER}) n returning id`,
        [ctx.orgId, ctx.c1, subject, shift(TODAY, -30)],
      )
    ).map((r) => r.id);
    await q(
      'insert into academy_exam_classes (exam_id, class_id) select e, $2 from unnest($1::uuid[]) e',
      [fillers, fx.cur],
    );
    await q(
      'insert into academy_scores (exam_id, student_id, score) select e, $2, 80 from unnest($1::uuid[]) e',
      [fillers, student],
    );
    fx.before = await exam(ctx.c1, '任期內', shift(X, -5), fx.past);
    fx.after = await exam(ctx.c1, '卸任後', shift(X, 5), fx.past);
    fx.other = await exam(ctx.c1, '別人的', shift(X, 1), fx.others);
    fx.c2exam = await exam(c2, '二校的', shift(X, 2), fx.c2);
    app = (await import('../index')).default as never;
  }, 180_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
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

  type List = { data: Array<{ id: string }>; meta: { total: number } };
  const list = async (who: Who, qs: string) => {
    ctx.who = who;
    try {
      const res = await app.request(`/api/academy-exams?${qs}`, {}, env);
      expect(res.status).toBe(200);
      return (await res.json()) as List;
    } finally {
      ctx.who = 'teacherA';
    }
  };
  const ids = (body: List) => body.data.map((r) => r.id);

  it(`老師 A：現任班 ${FILLER} 場＋前任任期內 1 場；卸任後、別人班、二校的看不到`, async () => {
    const p1 = await list('teacherA', 'pageSize=200');
    expect(p1.meta.total).toBe(FILLER + 1);
    expect(p1.data).toHaveLength(200);
    const p2 = await list('teacherA', 'pageSize=200&page=2');
    expect(p2.data).toHaveLength(FILLER + 1 - 200);
    const seen = new Set([...ids(p1), ...ids(p2)]);
    expect(seen.size).toBe(FILLER + 1);
    expect(seen.has(fx.before)).toBe(true);
    for (const hidden of [fx.after, fx.other, fx.c2exam]) expect(seen.has(hidden)).toBe(false);
    // 新到舊：任期內那場（X−5）比現任班的小考（今天−31 起往前）新
    expect(ids(p1)[0]).toBe(fx.before);
  });

  it('老師 A todo：只剩任期內沒登的那場（卸任後那場沒登也不算他的）', async () => {
    const body = await list('teacherA', 'todo=true');
    expect(body.meta.total).toBe(1);
    expect(ids(body)).toEqual([fx.before]);
  });

  it('老師 A 帶 class_id：前任班只有任期內；別人的班 → 空（參數撐不大範圍）', async () => {
    expect(ids(await list('teacherA', `class_id=${fx.past}`))).toEqual([fx.before]);
    expect((await list('teacherA', `class_id=${fx.others}`)).meta.total).toBe(0);
  });

  it('管理員帶 class_id（embed）：換手班兩場都在；受限 C1 帶二校班 → 空', async () => {
    const admin = await list('admin', `class_id=${fx.past}`);
    expect(admin.meta.total).toBe(2);
    expect(new Set(ids(admin))).toEqual(new Set([fx.before, fx.after]));
    expect((await list('admin', `class_id=${fx.c2}`)).meta.total).toBe(1);
    expect((await list('c1', `class_id=${fx.c2}`)).meta.total).toBe(0);
  });
});
