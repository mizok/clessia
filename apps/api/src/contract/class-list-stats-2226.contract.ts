import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2226：班級列表的課堂與在籍統計在 DB 端數**（保留類：授權範圍、聚合口徑），對真的本機 Postgres 跑。
 *
 * 原本拿到本頁班級後發 4 支 `.in('class_id', classIds)` 撈逐堂原始列回來數：`pageSize=0` 班一多就 414、
 * 逐堂列被 max_rows（1000）截斷，錯誤又被吞成 0。fixture：C1 有 BIG 個班，其中「大班」未來有 1100 堂
 * 沒指派老師的課；C2 一個班，跟 C1 的「衝堂班」同一位老師同一時段。
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

const BIG = 260;
const HUGE = 1100;

run('#2226 班級列表的統計在 DB 端數（GET /classes）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { huge: '', clash: '', enrolled: '', other: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2226 契約：班級統計')", []);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    ctx.c1 = await one("insert into campuses (org_id, name) values ($1, 'c1')", [ctx.orgId]);
    const c2 = await one("insert into campuses (org_id, name) values ($1, 'c2')", [ctx.orgId]);
    const course = async (campus: string) =>
      one('insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)', [
        ctx.orgId,
        campus,
        '數學',
        subject,
      ]);
    const k1 = await course(ctx.c1);
    const k2 = await course(c2);
    await q(
      `insert into classes (org_id, campus_id, course_id, name)
       select $1, $2, $3, '班 ' || n from generate_series(1, ${BIG}) n`,
      [ctx.orgId, ctx.c1, k1],
    );
    const byName = async (name: string) =>
      (
        await q<{ id: string }>('select id from classes where org_id = $1 and name = $2', [
          ctx.orgId,
          name,
        ])
      )[0]!.id;
    fx.huge = await byName('班 1');
    fx.clash = await byName('班 2');
    fx.enrolled = await byName('班 3');
    fx.other = await one(
      "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '二校班')",
      [ctx.orgId, c2, k2],
    );
    const staff = await one(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '老師')",
      [ctx.orgId, ctx.userId],
    );
    const sess = (classId: string, date: string, start: string, end: string, extra = '') =>
      q(
        `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status${extra ? ', teacher_id' : ''})
         values ($1, $2, $3, $4, $5, 'scheduled', ${extra ? "'assigned', $6" : "'unassigned'"})`,
        extra
          ? [ctx.orgId, classId, date, start, end, extra]
          : [ctx.orgId, classId, date, start, end],
      );
    // 大班：未來 HUGE 堂、都沒指派；另有一堂過去的、兩堂未來停課
    await q(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
       select $1, $2, date '2027-01-01' + n, '18:00', '19:00', 'scheduled', 'unassigned'
         from generate_series(0, ${HUGE - 1}) n`,
      [ctx.orgId, fx.huge],
    );
    await q(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
       values ($1, $2, '2020-01-06', '18:00', '19:00', 'scheduled', 'unassigned'),
              ($1, $2, '2031-01-06', '10:00', '11:00', 'cancelled', 'unassigned'),
              ($1, $2, '2031-01-07', '10:00', '11:00', 'cancelled', 'unassigned')`,
      [ctx.orgId, fx.huge],
    );
    // 衝堂班：同日兩堂重疊（班內衝突 1）；同一位老師同時段在二校班也有課（跨班老師衝突）
    await sess(fx.clash, '2032-03-01', '18:00', '20:00', staff);
    await sess(fx.clash, '2032-03-01', '19:00', '21:00', staff);
    await sess(fx.clash, '2032-03-01', '21:00', '22:00', staff); // 接在後面、不重疊
    await sess(fx.other, '2032-03-01', '18:30', '19:30', staff);
    // 在籍：同 countEnrolledOn —— active、今天在生效區間內（結束當天還算）
    const student = async () =>
      one("insert into students (org_id, name, grade) values ($1, '生', 'J1')", [ctx.orgId]);
    const enroll = async (status: string, from: string, to: string | null) =>
      q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from, effective_to)
         values ($1, $2, $3, $4::enrollment_status, 'monthly', 1000, $5, $6)`,
        [ctx.orgId, fx.enrolled, await student(), status, from, to],
      );
    await enroll('active', '2000-01-01', null);
    await enroll('active', '2000-01-01', '2999-12-31');
    await enroll('active', '2000-01-01', '2000-06-01'); // 已結束
    await enroll('active', '2999-01-01', null); // 還沒開始
    await enroll('withdrawal', '2000-01-01', null); // 不是 active
    app = (await import('../index')).default as never;
  }, 180_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from enrollments where org_id = $1',
      'delete from students where org_id = $1',
      'delete from sessions where org_id = $1',
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

  type Row = {
    id: string;
    hasUpcomingSessions: boolean;
    hasPastSessions: boolean;
    upcomingCancelledCount: number;
    upcomingUnassignedCount: number;
    upcomingClassConflictCount: number;
    upcomingTeacherConflictCount: number;
    enrolledCount?: number;
  };
  const list = async (who: Who, qs: string) => {
    ctx.who = who;
    try {
      return await app.request(`/api/classes?${qs}`, {}, env);
    } finally {
      ctx.who = 'admin';
    }
  };
  const rows = async (who: Who, qs: string) => {
    const res = await list(who, qs);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Row[] };
    return new Map(body.data.map((r) => [r.id, r]));
  };

  it(`pageSize=0、${BIG + 1} 個班：照樣 200，大班 ${HUGE} 堂未指派全數到、停課 2、有過去課堂`, async () => {
    const all = await rows('admin', 'pageSize=0');
    expect(all.size).toBe(BIG + 1);
    expect(all.get(fx.huge)).toMatchObject({
      hasUpcomingSessions: true,
      hasPastSessions: true,
      upcomingUnassignedCount: HUGE,
      upcomingCancelledCount: 2,
      upcomingClassConflictCount: 0,
    });
    expect(all.get(fx.clash)).toMatchObject({
      hasPastSessions: false,
      upcomingUnassignedCount: 0,
      upcomingClassConflictCount: 1,
      // 班內兩堂各撞二校班那堂一次、彼此也撞一次：3 對裡衝堂班出現 4 次
      upcomingTeacherConflictCount: 4,
    });
    expect(all.get(fx.other)?.upcomingTeacherConflictCount).toBe(2);
    expect(all.get(fx.enrolled)?.enrolledCount).toBe(2);
    expect(all.get(fx.enrolled)).toMatchObject({
      hasUpcomingSessions: false,
      hasPastSessions: false,
    });
  });

  it('分頁模式：大班在頁內也一樣數齊（原本逐堂列被 max_rows 1000 截斷）', async () => {
    const page = await rows('admin', 'pageSize=200&search=' + encodeURIComponent('班 1'));
    expect(page.get(fx.huge)?.upcomingUnassignedCount).toBe(HUGE);
  });

  it('受限 C1：看不到二校班，老師衝突只算 C1 自己的班（不從二校帶進來）', async () => {
    const c1 = await rows('c1', 'pageSize=0');
    expect(c1.size).toBe(BIG);
    expect(c1.has(fx.other)).toBe(false);
    expect(c1.get(fx.clash)?.upcomingTeacherConflictCount).toBe(2);
    expect(c1.get(fx.huge)?.upcomingUnassignedCount).toBe(HUGE);
  });

  it('統計查詢失敗 → 500，不回 0', async () => {
    expect((await list('broken', 'pageSize=0')).status).toBe(500);
  });

  it('pageSize 上限 200', async () => {
    const res = await list('admin', 'pageSize=5000');
    const body = (await res.json()) as { data: Row[]; meta: { pageSize: number } };
    expect(body.meta.pageSize).toBe(200);
    expect(body.data).toHaveLength(200);
  });
});
