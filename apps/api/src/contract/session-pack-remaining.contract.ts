import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **開很久的班，堂數帳的已扣、剩餘照樣算對**（#1928），對真 DB 跑。
 *
 * 原本把這個班歷來所有沒停課課堂的 event_id 塞進 `.in()` 撈出勤：班開越久 id 越多 → 414 →
 * 錯誤被吞 → 已扣 0、剩餘＝已購（金額路徑：剩餘堂數拿去判斷要不要續購或收費）。
 *
 * 自建一個 org：一個班 600 堂沒停課＋30 堂停課，學生每堂都有出勤（每 10 堂 1 次請假、其餘到），
 * 停課那 30 堂也有已點好的名（不能扣，#485）。班設定請假不扣（`leave_deducts_session = false`）。
 * 買了 700 堂 → 應扣 540（600 − 60 次請假）、剩 160。測完整個 org 刪掉。
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
      set('supabase', supabase);
      set('orgId', ctx.orgId);
      set('userId', ctx.userId);
      set('roles', ['admin']);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', 'admin');
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', null);
      set('auth', { pool: { query: pool!.query.bind(pool), end: async () => undefined } });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

const LIVE = 600;
const CANCELLED = 30;
const PURCHASED = 700;

run('堂數帳在開很久的班上（#1928）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  let enrollmentId = '';

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#1928 契約：堂數帳') returning id",
      )
    )[0]!.id;
    const [campus] = await q<{ id: string }>(
      "insert into campuses (org_id, name) values ($1, '分校') returning id",
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
      `insert into classes (org_id, campus_id, course_id, name, leave_deducts_session)
       values ($1, $2, $3, '開很久的班', false) returning id`,
      [ctx.orgId, campus!.id, course!.id],
    );
    const [student] = await q<{ id: string }>(
      "insert into students (org_id, name, grade) values ($1, '老學生', 'J1') returning id",
      [ctx.orgId],
    );
    const [enrollment] = await q<{ id: string }>(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, effective_from)
       values ($1, $2, $3, 'active', 'session_pack', '2024-01-01') returning id`,
      [ctx.orgId, klass!.id, student!.id],
    );
    enrollmentId = enrollment!.id;
    await q(
      'insert into session_packs (org_id, enrollment_id, purchased_count) values ($1, $2, $3)',
      [ctx.orgId, enrollmentId, PURCHASED],
    );
    // 600 堂沒停課＋30 堂停課，每堂一個 event
    await q(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
       select $1, $2, date '2024-01-01' + g, '19:00', '20:30',
              case when g > $3::int then 'cancelled' else 'completed' end, 'unassigned'
         from generate_series(1, $3::int + $4::int) g`,
      [ctx.orgId, klass!.id, LIVE, CANCELLED],
    );
    await q(
      `with e as (
         insert into events (org_id, event_type, title, event_date)
         select $1, 'session', s.id::text, s.session_date from sessions s where s.org_id = $1
         returning id, title
       )
       update sessions s set event_id = e.id from e where s.id::text = e.title`,
      [ctx.orgId],
    );
    // 每堂都有出勤（停課那 30 堂也有：老師在停課前就點好名了）；每 10 堂 1 次請假
    await q(
      `insert into attendance_records (org_id, event_id, student_id, status)
       select $1, s.event_id, $2,
              (case when row_number() over (order by s.session_date) % 10 = 0
                    then 'on_leave' else 'present' end)::attendance_status
         from sessions s where s.org_id = $1`,
      [ctx.orgId, student!.id],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    await q('delete from attendance_records where org_id = $1', [ctx.orgId]);
    await q('delete from sessions where org_id = $1', [ctx.orgId]);
    await q('delete from events where org_id = $1', [ctx.orgId]);
    await q('delete from session_packs where org_id = $1', [ctx.orgId]);
    await q('delete from enrollments where org_id = $1', [ctx.orgId]);
    await q('delete from students where org_id = $1', [ctx.orgId]);
    await q('delete from organizations where id = $1', [ctx.orgId]);
  }, 120_000);

  it('買 700、600 堂沒停課（其中 60 次請假、請假不扣）、30 堂停課 → 已扣 540、剩 160', async () => {
    const res = await app.request(`/api/session-packs?enrollmentId=${enrollmentId}`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { purchased: number; deducted: number; remaining: number };
    };
    expect(body.summary).toMatchObject({ purchased: PURCHASED, deducted: 540, remaining: 160 });
  });
});
