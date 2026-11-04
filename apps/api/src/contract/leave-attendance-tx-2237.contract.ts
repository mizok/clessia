import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { deleteLeaveAttendance } from '../lib/leave-write';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2237：請假與它的出勤連動同一筆交易**，對真的本機 Postgres／PostgREST 跑。
 *
 * 原本先 COMMIT 請假、再用 PostgREST 寫 on_leave：寫失敗回 500 但假已經在，使用者重送撞 409，
 * 出勤永遠沒蓋到；刪除時先刪假、再撤 on_leave，撤失敗回 500 但假已經沒了，on_leave 沒人收得回來。
 * 這裡用一支**只對這位學生生效**的 trigger 讓 attendance_records 的寫入在 DB 端失敗，
 * 舊碼（PostgREST）與新碼（pg 交易）都吃得到同一個錯。
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

const D = '2027-03-01';
const FN = 'public.contract_2237_fail';

run('#2237 請假與出勤連動同一筆交易（POST／DELETE /leaves）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const fx = { student: '' };

  /** 讓這位學生的出勤寫入（INSERT／UPDATE 或 DELETE）在 DB 端失敗，跑完 fn 就拆掉 */
  const withAttendanceFailing = async (
    op: 'INSERT OR UPDATE' | 'DELETE',
    fn: () => Promise<void>,
  ) => {
    const row = op === 'DELETE' ? 'old' : 'new';
    await q(`create or replace function ${FN}() returns trigger language plpgsql as $$
             begin raise exception 'contract 2237: attendance write blocked'; end $$`);
    await q(`create trigger contract_2237_fail before ${op} on public.attendance_records
             for each row when (${row}.student_id = '${fx.student}'::uuid) execute function ${FN}()`);
    try {
      await fn();
    } finally {
      await q('drop trigger if exists contract_2237_fail on public.attendance_records');
      await q(`drop function if exists ${FN}()`);
    }
  };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#2237 契約：請假出勤同交易') returning id",
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
    const [klass] = await q<{ id: string }>(
      "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '班') returning id",
      [ctx.orgId, campus!.id, course!.id],
    );
    const [event] = await q<{ id: string }>(
      `insert into events (org_id, event_type, title, event_date, start_time, end_time)
       values ($1, 'session', '課', $2, '18:00', '19:00') returning id`,
      [ctx.orgId, D],
    );
    await q(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status, event_id)
       values ($1, $2, $3, '18:00', '19:00', 'scheduled', 'unassigned', $4)`,
      [ctx.orgId, klass!.id, D, event!.id],
    );
    fx.student = (
      await q<{ id: string }>(
        "insert into students (org_id, name, grade) values ($1, '請假的學生', 'J1') returning id",
        [ctx.orgId],
      )
    )[0]!.id;
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       values ($1, $2, $3, 'active', 'monthly', 1000, '2027-01-01')`,
      [ctx.orgId, klass!.id, fx.student],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    await q('drop trigger if exists contract_2237_fail on public.attendance_records');
    await q(`drop function if exists ${FN}()`);
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

  const leaves = () =>
    q<{ id: string }>('select id from leave_requests where org_id = $1 and student_id = $2', [
      ctx.orgId,
      fx.student,
    ]);
  const onLeave = () =>
    q<{ id: string }>(
      "select id from attendance_records where org_id = $1 and student_id = $2 and status = 'on_leave'",
      [ctx.orgId, fx.student],
    );
  const post = () =>
    app.request(
      '/api/leaves',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentId: fx.student, startDate: D, endDate: D }),
      },
      env,
    );

  it('建立：出勤寫入失敗 → 500、假不在；重送 → 201、出勤 on_leave', async () => {
    await withAttendanceFailing('INSERT OR UPDATE', async () => {
      expect((await post()).status).toBe(500);
    });
    expect(await leaves()).toEqual([]);
    expect(await onLeave()).toEqual([]);

    expect((await post()).status).toBe(201);
    expect(await leaves()).toHaveLength(1);
    expect(await onLeave()).toHaveLength(1);
  });

  it('刪除：撤出勤失敗 → 500、假與 on_leave 都還在；重送 → 204、兩者都清掉', async () => {
    // 自己建起點，不靠上一條留下的狀態
    await q('delete from attendance_records where org_id = $1', [ctx.orgId]);
    await q('delete from leave_requests where org_id = $1', [ctx.orgId]);
    expect((await post()).status).toBe(201);
    expect(await onLeave()).toHaveLength(1);
    const [leave] = await leaves();
    const del = () => app.request(`/api/leaves/${leave!.id}?mode=full`, { method: 'DELETE' }, env);

    await withAttendanceFailing('DELETE', async () => {
      expect((await del()).status).toBe(500);
    });
    expect(await leaves()).toHaveLength(1);
    expect(await onLeave()).toHaveLength(1);

    expect((await del()).status).toBe(204);
    expect(await leaves()).toEqual([]);
    expect(await onLeave()).toEqual([]);
  });
  it('撤出勤：算完之後那堂被點了名 → deleteLeaveAttendance 回 0、紀錄還在（交易裡再判一次）', async () => {
    await q('delete from attendance_records where org_id = $1', [ctx.orgId]);
    await q('delete from leave_requests where org_id = $1', [ctx.orgId]);
    expect((await post()).status).toBe(201);
    const [rec] = await q<{ id: string; event_id: string }>(
      "select id, event_id from attendance_records where org_id = $1 and student_id = $2 and status = 'on_leave'",
      [ctx.orgId, fx.student],
    );
    // 「算」已經拿到這筆 id；之後、寫之前，老師點了名
    await q('update events set attendance_taken_at = now() where id = $1', [rec!.event_id]);
    expect(await deleteLeaveAttendance(pool!, ctx.orgId, fx.student, [rec!.id])).toBe(0);
    expect(await onLeave()).toHaveLength(1);

    // 對照：還沒點名就刪得掉 —— 不是永遠回 0
    await q('update events set attendance_taken_at = null where id = $1', [rec!.event_id]);
    expect(await deleteLeaveAttendance(pool!, ctx.orgId, fx.student, [rec!.id])).toBe(1);
    expect(await onLeave()).toEqual([]);
  });
});
