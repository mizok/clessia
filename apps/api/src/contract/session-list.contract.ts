import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **課表月檢視（`GET /api/sessions`，一次 500 堂）的出勤、在籍、異動對真 DB 正確**（#1928）。
 *
 * 原本主查詢之後的三支補充讀取把 500 個 id 塞進 `.in()`：異動那支 414 → 整頁 400；
 * 出勤那支錯誤沒檢查 → 出勤數靜默 0；就算沒 414，出勤列也遠超過 1000 → 被截斷 → 數字算錯。
 *
 * 這支自建一個 org：25 班 × 每班 20 堂（5 月，共 500 堂）、每班 25 人、每堂 25 筆出勤（共 12500 列），
 * 前 10 堂各有兩筆異動。斷言：
 * 1. `pageSize=500` 回 200，每一堂的到／請／缺、在籍人數、最新異動，都跟直接用 SQL 算的一樣
 * 2. 小頁（REST 也撐得住的量）時，pg 路徑與 REST 路徑的回應完全相同（欄位格式沒有因為改走 pg 而變）
 * 測完整個 org 刪掉。
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

const ctx = { orgId: '', userId: '', usePool: true };

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
      // REST 模式：不放 auth（沒有 pool 才走 REST；authPoolCleanup 遇到沒有 auth 會直接略過）
      if (ctx.usePool) {
        set('auth', { pool: { query: pool!.query.bind(pool), end: async () => undefined } });
      }
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

const CLASSES = 25;
const SESSIONS_PER_CLASS = 20;
const STUDENTS_PER_CLASS = 25;

interface SessionItem {
  id: string;
  attendancePresentCount: number;
  attendanceOnLeaveCount: number;
  attendanceAbsentCount: number;
  attendanceEnrolledCount: number;
  latestChange: { type: string; reason: string | null } | null;
}

run('課表月檢視一次 500 堂（#1928）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#1928 契約：月檢視') returning id",
      )
    )[0]!.id;
    const [campus] = await q<{ id: string }>(
      "insert into campuses (org_id, name) values ($1, '月檢視分校') returning id",
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
    await q(
      `insert into classes (org_id, campus_id, course_id, name)
       select $1, $2, $3, '班' || g from generate_series(1, $4::int) g`,
      [ctx.orgId, campus!.id, course!.id, CLASSES],
    );
    // 每班 25 人
    await q(
      `with k as (select id, row_number() over (order by id) as kn from classes where org_id = $1),
            s as (
              insert into students (org_id, name, grade)
              select $1, '生' || k.kn || '-' || g, 'J1' from k cross join generate_series(1, $2::int) g
              returning id, name
            )
       insert into enrollments (org_id, class_id, student_id, status, effective_from)
       select $1, k.id, s.id, 'active', '2026-01-01'
         from s join k on s.name like '生' || k.kn || '-%'`,
      [ctx.orgId, STUDENTS_PER_CLASS],
    );
    // 每班 20 堂（5 月），每堂一個 event
    await q(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
       select $1, k.id, date '2026-05-01' + (d - 1), '19:00', '20:30', 'completed', 'unassigned'
         from classes k cross join generate_series(1, $2::int) d
        where k.org_id = $1`,
      [ctx.orgId, SESSIONS_PER_CLASS],
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
    // 每堂 25 筆出勤：學生序號 mod 5 = 0 缺、= 1 請假、其餘到
    await q(
      `insert into attendance_records (org_id, event_id, student_id, status)
       select $1, s.event_id, e.student_id,
              (case (row_number() over (partition by s.id order by e.student_id)) % 5
                 when 0 then 'absent' when 1 then 'on_leave' else 'present' end)::attendance_status
         from sessions s join enrollments e on e.class_id = s.class_id
        where s.org_id = $1`,
      [ctx.orgId],
    );
    // 前 10 堂各兩筆異動，後寫的那筆才是最新
    await q(
      `insert into schedule_changes (org_id, session_id, change_type, reason, created_at)
       select $1, s.id, t.change_type::schedule_change_type, t.reason, now() - t.ago
         from (select id from sessions where org_id = $1 order by session_date, id limit 10) s
         cross join (values ('substitute', '舊的那筆', interval '2 days'),
                            ('reschedule', '最新的那筆', interval '1 day')) t(change_type, reason, ago)`,
      [ctx.orgId],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    await q('delete from attendance_records where org_id = $1', [ctx.orgId]);
    await q('delete from schedule_changes where org_id = $1', [ctx.orgId]);
    await q('delete from sessions where org_id = $1', [ctx.orgId]);
    await q('delete from events where org_id = $1', [ctx.orgId]);
    await q('delete from enrollments where org_id = $1', [ctx.orgId]);
    await q('delete from students where org_id = $1', [ctx.orgId]);
    await q('delete from organizations where id = $1', [ctx.orgId]);
  }, 120_000);

  const list = async (qs: string, usePool: boolean) => {
    ctx.usePool = usePool;
    const res = await app.request(`/api/sessions?${qs}`, {}, env);
    return { status: res.status, body: (await res.json()) as { data: SessionItem[] } };
  };

  it('pageSize=500：200，每堂的到／請／缺、在籍、最新異動都跟 SQL 直接算的一樣', async () => {
    const { status, body } = await list('from=2026-05-01&to=2026-05-31&pageSize=500', true);
    expect(status).toBe(200);
    expect(body.data).toHaveLength(CLASSES * SESSIONS_PER_CLASS);

    const expected = await q<{
      id: string;
      present: string;
      on_leave: string;
      absent: string;
      latest: string | null;
    }>(
      `select s.id,
              count(*) filter (where ar.status = 'present') as present,
              count(*) filter (where ar.status = 'on_leave') as on_leave,
              count(*) filter (where ar.status = 'absent') as absent,
              (select sc.reason from schedule_changes sc where sc.session_id = s.id
                order by sc.created_at desc limit 1) as latest
         from sessions s left join attendance_records ar on ar.event_id = s.event_id
        where s.org_id = $1 group by s.id`,
      [ctx.orgId],
    );
    const byId = new Map(expected.map((r) => [r.id, r]));
    const mismatches = body.data.filter((s) => {
      const e = byId.get(s.id)!;
      return (
        s.attendancePresentCount !== Number(e.present) ||
        s.attendanceOnLeaveCount !== Number(e.on_leave) ||
        s.attendanceAbsentCount !== Number(e.absent) ||
        s.attendanceEnrolledCount !== STUDENTS_PER_CLASS ||
        (s.latestChange?.reason ?? null) !== e.latest
      );
    });
    expect(mismatches.map((s) => s.id)).toEqual([]);
    // 有東西可比：出勤列總數遠超過 1000，而且真的有到、請假、缺席三種
    const total = body.data.reduce(
      (n, s) => n + s.attendancePresentCount + s.attendanceOnLeaveCount + s.attendanceAbsentCount,
      0,
    );
    expect(total).toBe(CLASSES * SESSIONS_PER_CLASS * STUDENTS_PER_CLASS);
    expect(body.data.filter((s) => s.latestChange?.type === 'reschedule')).toHaveLength(10);
  }, 120_000);

  it('小頁時 pg 路徑與 REST 路徑的回應完全相同（改走 pg 沒有改到欄位格式）', async () => {
    for (const qs of [
      // 5/1 那 25 堂（含全部 10 堂有異動的）：25 個 id、625 列出勤，REST 也撐得住
      'from=2026-05-01&to=2026-05-01&pageSize=25',
      'from=2026-05-01&to=2026-05-31&pageSize=10&page=7',
    ]) {
      const viaPg = await list(qs, true);
      const viaRest = await list(qs, false);
      expect(viaPg.status).toBe(200);
      expect(viaPg).toEqual(viaRest);
    }
    const firstDay = await list('from=2026-05-01&to=2026-05-01&pageSize=25', true);
    expect(firstDay.body.data.filter((s) => s.latestChange !== null)).toHaveLength(10);
  }, 120_000);
});
