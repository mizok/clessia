import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2231：請假寫 on_leave／撤銷 on_leave 只看這位學生的班**，對真的本機 PostgREST 跑。
 *
 * 原本建立請假時撈假期間**全 org** 有課的事件，把那些班 id `.in()` 回 enrollments；撤銷時撈全 org
 * 還沒點名的事件，把整串 event id `.in()` 進 delete。大 org 兩條都 414，而錯誤被吞：
 * 建立回 201 但出勤**沒寫 on_leave**，撤銷回 204 但 **on_leave 還在**。
 * fixture：同一天 BIG 個班各一堂（各有出勤事件），學生只在第一班。
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

const ctx = { orgId: '', userId: '' };

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
      // 請假寫入走 withTx（#1957），要 connect
      const authPool = {
        query: pool!.query.bind(pool),
        connect: pool!.connect.bind(pool),
        end: async () => undefined,
      };
      set('supabase', supabase);
      set('orgId', ctx.orgId);
      set('userId', ctx.userId);
      set('roles', ['admin']);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', 'admin');
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId, authPool as never));
      set('campusScope', null);
      set('auth', { pool: authPool });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

const BIG = 300;
const D = '2027-03-01';

run('#2231 請假的 on_leave 只看這位學生的班（POST／DELETE /leaves）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const fx = { student: '', mine: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#2231 契約：請假 on_leave') returning id",
      )
    )[0]!.id;
    const [campus] = await q<{ id: string }>(
      "insert into campuses (org_id, name) values ($1, '本校') returning id",
      [ctx.orgId],
    );
    const [subject] = await q<{ id: string }>(
      "insert into subjects (org_id, name) values ($1, '數學') returning id",
      [ctx.orgId],
    );
    const [course] = await q<{ id: string }>(
      "insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, '數學', $3) returning id",
      [ctx.orgId, campus!.id, subject!.id],
    );
    const classes = await q<{ id: string }>(
      `insert into classes (org_id, campus_id, course_id, name)
       select $1, $2, $3, '班 ' || n from generate_series(1, ${BIG}) n returning id`,
      [ctx.orgId, campus!.id, course!.id],
    );
    await q(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
       select $1, unnest($2::uuid[]), $3, '18:00', '19:00', 'scheduled', 'unassigned'`,
      [ctx.orgId, classes.map((c) => c.id), D],
    );
    await q(
      `with e as (
         insert into events (org_id, event_type, title, event_date, start_time, end_time)
         select $1, 'session', s.id::text, s.session_date, s.start_time, s.end_time
           from sessions s where s.org_id = $1
         returning id, title)
       update sessions s set event_id = e.id from e where s.id::text = e.title`,
      [ctx.orgId],
    );
    fx.mine = classes[0]!.id;
    fx.student = (
      await q<{ id: string }>(
        "insert into students (org_id, name, grade) values ($1, '請假的學生', 'J1') returning id",
        [ctx.orgId],
      )
    )[0]!.id;
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       values ($1, $2, $3, 'active', 'monthly', 1000, '2027-01-01')`,
      [ctx.orgId, fx.mine, fx.student],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from attendance_records where org_id = $1',
      'delete from leave_request_sessions where org_id = $1',
      'delete from leave_requests where org_id = $1',
      'update sessions set event_id = null where org_id = $1',
      'delete from events where org_id = $1',
      'delete from sessions where org_id = $1',
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

  const onLeave = async () =>
    q<{ class_id: string }>(
      `select s.class_id from attendance_records r join sessions s on s.event_id = r.event_id
        where r.org_id = $1 and r.student_id = $2 and r.status = 'on_leave'`,
      [ctx.orgId, fx.student],
    );

  it(`同一天全 org ${BIG} 個班有課：建立請假照樣把這位學生那一堂寫成 on_leave；撤銷照樣刪掉`, async () => {
    const created = await app.request(
      '/api/leaves',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentId: fx.student, startDate: D, endDate: D }),
      },
      env,
    );
    expect(created.status).toBe(201);
    expect((await onLeave()).map((r) => r.class_id)).toEqual([fx.mine]);

    const { id } = (await created.json()) as { id: string };
    const removed = await app.request(
      `/api/leaves/${id}?mode=full`,
      { method: 'DELETE' },
      env,
    );
    expect(removed.status).toBe(204);
    expect(await onLeave()).toEqual([]);
  });
});
