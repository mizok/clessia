import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **請假列表的分校／開課班／課程範圍，在學生很多的分校也對**（#1928）。
 *
 * 原本先撈「分校（或班、課程）歷年報名過的學生 id」，再塞回 `.in('student_id', …)`：大分校網址太長 → 414，
 * 報名那支也被 max_rows（1000）截斷而漏人；讀失敗還被當成「一個學生都沒有」回空列表。
 * 改成請假單那支查詢自己 join：`students!inner(… enrollments!inner(… classes!inner(…)))`。
 *
 * 這支自建一個 org：A 分校 1200 名學生（都報 A 班），第 1150 名請假；B 分校另一位學生請假；
 * 還有一位「跨校」學生在 A 分校上 X 課、在 B 分校上 Y 課，也請了假 ——
 * 守「同一筆報名同時符合分校與課程」的語意（篩 A 分校＋Y 課不該有他）。測完整個 org 刪掉。
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

const ctx = { orgId: '', userId: '', campusScope: null as readonly string[] | null };

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

const STUDENTS = 1200;
const LEAVER = 1150;

run('請假列表的範圍：1200 名學生的分校（#1928）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const ids = { campusA: '', campusB: '', classA: '', classB: '', courseX: '', courseY: '' };
  const leave = { a: '', b: '', cross: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#1928 契約：請假範圍') returning id",
      )
    )[0]!.id;
    const org = ctx.orgId;
    const one = async (sql: string, values: unknown[]) =>
      (await q<{ id: string }>(sql, values))[0]!.id;
    ids.campusA = await one(
      "insert into campuses (org_id, name) values ($1, 'A 分校') returning id",
      [org],
    );
    ids.campusB = await one(
      "insert into campuses (org_id, name) values ($1, 'B 分校') returning id",
      [org],
    );
    const subject = await one(
      "insert into subjects (org_id, name) values ($1, '數學') returning id",
      [org],
    );
    ids.courseX = await one(
      "insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, 'X 課', $3) returning id",
      [org, ids.campusA, subject],
    );
    ids.courseY = await one(
      "insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, 'Y 課', $3) returning id",
      [org, ids.campusB, subject],
    );
    ids.classA = await one(
      "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, 'A 班') returning id",
      [org, ids.campusA, ids.courseX],
    );
    ids.classB = await one(
      "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, 'B 班') returning id",
      [org, ids.campusB, ids.courseY],
    );
    // A 分校 1200 名學生，都報 A 班
    await q(
      `with s as (
         insert into students (org_id, name, grade)
         select $1, 'A生' || lpad(g::text, 4, '0'), 'J1' from generate_series(1, $2::int) g
         returning id
       )
       insert into enrollments (org_id, class_id, student_id, status, effective_from)
       select $1, $3, s.id, 'active', '2026-01-01' from s`,
      [org, STUDENTS, ids.classA],
    );
    const studentB = await one(
      "insert into students (org_id, name, grade) values ($1, 'B生', 'J1') returning id",
      [org],
    );
    await q(
      "insert into enrollments (org_id, class_id, student_id, status, effective_from) values ($1, $2, $3, 'active', '2026-01-01')",
      [org, ids.classB, studentB],
    );
    // 跨校：A 班（A 分校、X 課）＋ B 班（B 分校、Y 課）
    const cross = await one(
      "insert into students (org_id, name, grade) values ($1, '跨校生', 'J1') returning id",
      [org],
    );
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, effective_from)
       values ($1, $2, $4, 'active', '2026-01-01'), ($1, $3, $4, 'active', '2026-01-01')`,
      [org, ids.classA, ids.classB, cross],
    );
    const leaver = await one('select id from students where org_id = $1 and name = $2', [
      org,
      `A生${String(LEAVER).padStart(4, '0')}`,
    ]);
    const addLeave = (studentId: string) =>
      one(
        `insert into leave_requests (org_id, student_id, start_date, end_date, submitted_by, submitted_by_role)
         values ($1, $2, '2026-06-01', '2026-06-01', $3, 'admin') returning id`,
        [org, studentId, ctx.userId],
      );
    leave.a = await addLeave(leaver);
    leave.b = await addLeave(studentB);
    leave.cross = await addLeave(cross);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const t of [
      'leave_requests',
      'enrollments',
      'students',
      'classes',
      'courses',
      'subjects',
      'campuses',
    ])
      await q(`delete from ${t} where org_id = $1`, [ctx.orgId]);
    await q('delete from organizations where id = $1', [ctx.orgId]);
  }, 120_000);

  const list = async (qs: string, scope: readonly string[] | null = null) => {
    ctx.campusScope = scope;
    const res = await app.request(`/api/leaves?pageSize=100&${qs}`, {}, env);
    const body = (await res.json()) as { data: { id: string }[]; meta: { total: number } };
    return {
      status: res.status,
      ids: (body.data ?? []).map((r) => r.id).sort(),
      total: body.meta?.total,
    };
  };
  const sorted = (...xs: string[]) => [...xs].sort();

  it('只管 A 分校的管理員：看得到 A 分校第 1150 名與跨校生的假，看不到 B 分校的', async () => {
    const res = await list('', [ids.campusA]);
    expect(res.status).toBe(200);
    expect(res.ids).toEqual(sorted(leave.a, leave.cross));
    expect(res.total).toBe(2);
  });

  it('開課班 A 班：A 分校那位與跨校生', async () => {
    const res = await list(`classId=${ids.classA}`);
    expect(res).toMatchObject({ status: 200, ids: sorted(leave.a, leave.cross), total: 2 });
  });

  it('課程 Y：B 分校那位與跨校生', async () => {
    const res = await list(`courseId=${ids.courseY}`);
    expect(res).toMatchObject({ status: 200, ids: sorted(leave.b, leave.cross), total: 2 });
  });

  it('A 分校＋Y 課：同一筆報名要同時符合 → 一筆都沒有（跨校生的兩筆報名各只符合一半）', async () => {
    const res = await list(`courseId=${ids.courseY}`, [ids.campusA]);
    expect(res).toMatchObject({ status: 200, ids: [], total: 0 });
  });

  it('不受限、不篩：三張都在', async () => {
    const res = await list('');
    expect(res).toMatchObject({
      status: 200,
      ids: sorted(leave.a, leave.b, leave.cross),
      total: 3,
    });
  });
});
