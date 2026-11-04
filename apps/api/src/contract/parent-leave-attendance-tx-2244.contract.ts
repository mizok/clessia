import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2244：家長請假與它的出勤連動同一筆交易**（#2237 同形狀，家長端 `POST /api/me/leaves`），對真的本機 Postgres／PostgREST 跑。
 *
 * 原本 `childDb.createLeave` 先 COMMIT 請假、再用 PostgREST upsert on_leave，**回傳值完全沒看**：
 * 寫失敗照樣回 201，假在、出勤沒蓋到。這裡用一支**只對這位學生生效**的 trigger 讓 attendance_records
 * 的寫入在 DB 端失敗，舊碼（PostgREST）與新碼（pg 交易）都吃得到同一個錯。
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

const ctx = { orgId: '', userId: '', studentId: '' };

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
      set('roles', ['parent']);
      set('permissions', []);
      set('activeRole', 'parent');
      set('studentScope', [ctx.studentId]);
      set(
        'childDb',
        createChildDb(supabase as never, [ctx.studentId], ctx.orgId, authPool as never),
      );
      set('campusScope', null);
      set('auth', { pool: authPool });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

const D = '2027-03-01';
const FN = 'public.contract_2244_fail';

run('#2244 家長請假與出勤連動同一筆交易（POST /me/leaves）', () => {
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
             begin raise exception 'contract 2244: attendance write blocked'; end $$`);
    await q(`create trigger contract_2244_fail before ${op} on public.attendance_records
             for each row when (${row}.student_id = '${fx.student}'::uuid) execute function ${FN}()`);
    try {
      await fn();
    } finally {
      await q('drop trigger if exists contract_2244_fail on public.attendance_records');
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
        "insert into organizations (name) values ('#2244 契約：家長請假出勤同交易') returning id",
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
    ctx.studentId = fx.student;
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       values ($1, $2, $3, 'active', 'monthly', 1000, '2027-01-01')`,
      [ctx.orgId, klass!.id, fx.student],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    await q('drop trigger if exists contract_2244_fail on public.attendance_records');
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
      'delete from notifications where org_id = $1',
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
      '/api/me/leaves',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentId: fx.student, startDate: D, endDate: D }),
      },
      env,
    );

  it('出勤寫入失敗 → 500、假不在（原本 201、假在、出勤沒蓋到）；重送 → 201、出勤 on_leave', async () => {
    await withAttendanceFailing('INSERT OR UPDATE', async () => {
      expect((await post()).status).toBe(500);
    });
    expect(await leaves()).toEqual([]);
    expect(await onLeave()).toEqual([]);

    expect((await post()).status).toBe(201);
    expect(await leaves()).toHaveLength(1);
    expect(await onLeave()).toHaveLength(1);
  });
});
