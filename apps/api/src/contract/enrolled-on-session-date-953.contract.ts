import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#953：在籍依課堂日期做滿**（計畫席 11-13 裁），對真的本機 PostgREST／Postgres 跑。
 *
 * 在籍＝報名生效區間涵蓋課堂日期＋狀態是 `active` 或 `withdrawal`。退班不再靠 status 排除（退班一定寫 `effective_to`）。
 * 契約三條：上個月的課在本月退班後人數不變、未來課堂不含退班生、作廢永遠不算。
 * 另外：待繳費（還沒生效）與休學（休學期間不在名單）在任何一堂都不出現（計畫席 11-13 裁）。
 * 另外一條：同一天退班又重報同一班（兩筆涵蓋同一天）只算一人、名單一列。
 *
 * fixture：一個班三堂（PAST、MID、FUTURE），六個學生，報名都從 2026-01-01 起
 * - 在讀：active
 * - 退班：withdrawal，到 WITHDRAWN_ON（PAST 之後、MID 之前）
 * - 作廢：void，到 WITHDRAWN_ON
 * - 重報：withdrawal 到 PAST ＋ active 從 PAST 起（PAST 那天兩筆都涵蓋）
 * - 待繳費：pending_payment，沒有結束日
 * - 休學：suspended，沒有結束日
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
      set('campusScope', null);
      set('auth', { pool: authPool });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

// 寫入要過「未來課堂不能點」的關，所以 PAST／MID 用真的過去、FUTURE 用遠未來（時間怎麼走都成立）
const PAST = '2026-01-10';
const WITHDRAWN_ON = '2026-02-01';
const MID = '2026-02-10';
const FUTURE = '2099-04-10';

run('#953 在籍依課堂日期：active／withdrawal，退班靠 effective_to', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const fx = {
    classId: '',
    active: '',
    withdrawn: '',
    voided: '',
    rejoined: '',
    pending: '',
    suspended: '',
    // 退班卻沒結束日（資料不一致）：fail-closed，哪一堂都不算
    wdNoEnd: '',
    // 日到班分校（今天一堂）：今天退班的兩個人（一個已打卡）＋一個在讀（已打卡）
    dailyEvent: '',
    wdTodayIn: '',
    wdTodayOut: '',
    dailyActive: '',
  };
  let today = '';
  const eventOf: Record<string, string> = {};

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name, attendance_mode) values ('#953 契約：在籍依課堂日期', 'per_session') returning id",
      )
    )[0]!.id;
    const [campus] = await q<{ id: string }>(
      "insert into campuses (org_id, name) values ($1, 'A 校') returning id",
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
    fx.classId = (
      await q<{ id: string }>(
        "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '數學班') returning id",
        [ctx.orgId, campus!.id, course!.id],
      )
    )[0]!.id;
    await q(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
       select $1, $2, d, '18:00', '19:00', 'scheduled', 'unassigned'
         from unnest($3::date[]) d`,
      [ctx.orgId, fx.classId, [PAST, MID, FUTURE]],
    );
    await q(
      `with e as (
         insert into events (org_id, event_type, title, event_date, start_time, end_time, campus_id)
         select $1, 'session', s.id::text, s.session_date, s.start_time, s.end_time, $2
           from sessions s where s.org_id = $1
         returning id, title)
       update sessions s set event_id = e.id from e where s.id::text = e.title`,
      [ctx.orgId, campus!.id],
    );
    for (const r of await q<{ event_id: string; d: string }>(
      'select event_id, session_date::text as d from sessions where org_id = $1',
      [ctx.orgId],
    )) {
      eventOf[r.d] = r.event_id;
    }
    [fx.active, fx.withdrawn, fx.voided, fx.rejoined, fx.pending, fx.suspended, fx.wdNoEnd] = (
      await q<{ id: string }>(
        `insert into students (org_id, name, grade)
         select $1, n, 'J1' from unnest(array['在讀','退班','作廢','重報','待繳費','休學','退班無結束日']) with ordinality t(n, i)
         order by i returning id`,
        [ctx.orgId],
      )
    ).map((r) => r.id) as [string, string, string, string, string, string, string];
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from, effective_to)
       values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01', null),
              ($1, $2, $4, 'withdrawal', 'monthly', 1000, '2026-01-01', $8),
              ($1, $2, $5, 'void', 'monthly', 1000, '2026-01-01', $8),
              ($1, $2, $6, 'withdrawal', 'monthly', 1000, '2026-01-01', $7),
              ($1, $2, $6, 'active', 'monthly', 1000, $7, null),
              ($1, $2, $9, 'pending_payment', 'monthly', 1000, '2026-01-01', null),
              ($1, $2, $10, 'suspended', 'monthly', 1000, '2026-01-01', null),
              ($1, $2, $11, 'withdrawal', 'monthly', 1000, '2026-01-01', null)`,
      [
        ctx.orgId,
        fx.classId,
        fx.active,
        fx.withdrawn,
        fx.voided,
        fx.rejoined,
        PAST,
        WITHDRAWN_ON,
        fx.pending,
        fx.suspended,
        fx.wdNoEnd,
      ],
    );
    // 日到班：記到班（attendance.ts check-in）與到班數（session-arrivals）也走同一個狀態前提
    today = (
      await q<{ d: string }>("select (now() at time zone 'Asia/Taipei')::date::text as d")
    )[0]!.d;
    const [daily] = await q<{ id: string }>(
      "insert into campuses (org_id, name, attendance_mode) values ($1, 'B 校', 'daily_checkin') returning id",
      [ctx.orgId],
    );
    const [dailyClass] = await q<{ id: string }>(
      "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '日到班班') returning id",
      [ctx.orgId, daily!.id, course!.id],
    );
    const [dailyEvent] = await q<{ id: string }>(
      `insert into events (org_id, event_type, title, event_date, start_time, end_time, campus_id)
       values ($1, 'session', '日到班', $2, '08:00', '09:00', $3) returning id`,
      [ctx.orgId, today, daily!.id],
    );
    fx.dailyEvent = dailyEvent!.id;
    await q(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status, event_id)
       values ($1, $2, $3, '08:00', '09:00', 'scheduled', 'unassigned', $4)`,
      [ctx.orgId, dailyClass!.id, today, fx.dailyEvent],
    );
    [fx.wdTodayIn, fx.wdTodayOut, fx.dailyActive] = (
      await q<{ id: string }>(
        `insert into students (org_id, name, grade)
         select $1, n, 'J1' from unnest(array['今天退班已打卡','今天退班沒打卡','日到班在讀']) with ordinality t(n, i)
         order by i returning id`,
        [ctx.orgId],
      )
    ).map((r) => r.id) as [string, string, string];
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from, effective_to)
       values ($1, $2, $3, 'withdrawal', 'monthly', 1000, '2026-01-01', $6),
              ($1, $2, $4, 'withdrawal', 'monthly', 1000, '2026-01-01', $6),
              ($1, $2, $5, 'active', 'monthly', 1000, '2026-01-01', null)`,
      [ctx.orgId, dailyClass!.id, fx.wdTodayIn, fx.wdTodayOut, fx.dailyActive, today],
    );
    await q(
      `insert into daily_checkins (org_id, campus_id, student_id, checkin_date)
       select $1, $2, s, $3 from unnest($4::uuid[]) s`,
      [ctx.orgId, daily!.id, today, [fx.wdTodayIn, fx.dailyActive]],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from daily_checkins where org_id = $1',
      'delete from attendance_records where org_id = $1',
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

  const workbenchCount = async (date: string) => {
    const res = await app.request(`/api/workbench/today?date=${date}`, {}, env);
    expect(res.status).toBe(200);
    const { sessions } = (await res.json()) as { sessions: Array<{ enrolledCount: number }> };
    expect(sessions).toHaveLength(1);
    return sessions[0]!.enrolledCount;
  };
  const sessionListCount = async (date: string) => {
    const res = await app.request(`/api/attendance/sessions?date=${date}&pageSize=100`, {}, env);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Array<{ enrolledCount: number }> };
    expect(data).toHaveLength(1);
    return data[0]!.enrolledCount;
  };
  const roster = async (date: string) => {
    const res = await app.request(`/api/attendance/roster/${eventOf[date]}`, {}, env);
    expect(res.status).toBe(200);
    const { students } = (await res.json()) as { students: Array<{ studentId: string }> };
    return students.map((s) => s.studentId);
  };

  it('上個月的課：本月退班的學生照算，重報那天只算一人，作廢不算', async () => {
    expect(await workbenchCount(PAST)).toBe(3);
    expect(await sessionListCount(PAST)).toBe(3);
    const ids = await roster(PAST);
    expect([...ids].sort()).toEqual([fx.active, fx.withdrawn, fx.rejoined].sort());
  });

  it('退班日之後的課（本月、未來）：不含退班生，作廢不算', async () => {
    for (const d of [MID, FUTURE]) {
      expect(await workbenchCount(d)).toBe(2);
      expect(await sessionListCount(d)).toBe(2);
      expect([...(await roster(d))].sort()).toEqual([fx.active, fx.rejoined].sort());
    }
  });

  it('待繳費與休學在任何一堂都不在名單、不算人數（休學前的過去課堂也不算＝已知限制）', async () => {
    for (const d of [PAST, MID, FUTURE]) {
      const ids = await roster(d);
      expect(ids).not.toContain(fx.pending);
      expect(ids).not.toContain(fx.suspended);
      expect(ids).not.toContain(fx.wdNoEnd);
    }
    // 人數已在上面兩條釘死（3／2），這裡只確認名單
  });

  it('點名寫入跟名單同一條：上個月的課可以替退班生補登，作廢的報名不行', async () => {
    const save = (studentId: string, date = PAST) =>
      app.request(
        '/api/attendance/batch',
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            eventId: eventOf[date],
            updates: [{ studentId, status: 'present' }],
          }),
        },
        env,
      );
    const voided = await save(fx.voided);
    expect(voided.status).toBe(400);
    // 確認是被在籍擋下，不是被別的關（例如「未來課堂」）擋下
    expect(((await voided.json()) as { error: string }).error).toBe('部分學生不在此課堂修課名單中');
    for (const id of [fx.pending, fx.suspended, fx.wdNoEnd]) {
      const res = await save(id);
      expect({ status: res.status, body: await res.text() }).toMatchObject({ status: 400 });
    }
    // 退班生只能補登退班日（effective_to）之前的課；之後那堂一樣擋
    const after = await save(fx.withdrawn, MID);
    expect(after.status).toBe(400);
    expect(((await after.json()) as { error: string }).error).toBe('部分學生不在此課堂修課名單中');
    const withdrawn = await save(fx.withdrawn);
    expect({ status: withdrawn.status, body: await withdrawn.text() }).toMatchObject({
      status: 200,
    });
  });

  it('日到班：今天退班的學生今天仍算到班（結束當天在籍），也記得了到班', async () => {
    const res = await app.request(`/api/attendance/sessions?date=${today}&pageSize=100`, {}, env);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: Array<{ eventId: string; enrolledCount: number; checkedInCount: number | null }>;
    };
    const s = data.find((row) => row.eventId === fx.dailyEvent);
    expect({ enrolled: s?.enrolledCount, checkedIn: s?.checkedInCount }).toEqual({
      enrolled: 3,
      checkedIn: 2,
    });

    const mark = await app.request(
      `/api/attendance/roster/${fx.dailyEvent}/check-in`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentId: fx.wdTodayOut }),
      },
      env,
    );
    expect({ status: mark.status, body: await mark.text() }).toMatchObject({ status: 201 });
  });
});
