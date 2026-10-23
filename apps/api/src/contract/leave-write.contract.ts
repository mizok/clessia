import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import {
  LEAVE_WINDOW_COLUMNS,
  leavesConflict,
  toLeaveWindow,
  type LeaveWindow,
} from '../lib/leave-covers-session';
import { findConflictingLeaveViaSql } from '../lib/leave-write';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **請假不重複**（#1957），對真的本機 PostgREST＋Postgres 跑。
 *
 * 1. 查重疊的 SQL 路徑（`findConflictingLeaveViaSql`）跟原本的 REST 路徑（`LEAVE_WINDOW_COLUMNS` 的 embed ＋
 *    `lte/gte`）**逐案比對**：同一組既有假、同一個新窗，兩條路判的要一樣，也要等於業務規則的預期
 * 2. 別的交易握著這位學生的鎖、寫了一張重疊的假還沒 COMMIT → POST／PATCH 要等它、再查，回 409（確定性競態）
 * 3. 同一個學生同時送兩張重疊的 POST → 一張 201、一張 409；同一天不同堂的兩張綁定假同時送 → 兩張都 201
 * 4. 鎖只鎖同一個學生：別的學生照常寫
 * 5. 家長端（#1970）走同一把鎖：家長連點、家長與行政同時送，都只會有一張
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
      // 請假寫入走 withTx（#1957），要 connect
      const authPool = {
        query: pool!.query.bind(pool),
        connect: pool!.connect.bind(pool),
        end: async () => undefined,
      };
      // `x-contract-parent-of: <studentId>` → 這次是那位學生的家長（#1970：家長與行政同時送）
      const childOf = c.req.header('x-contract-parent-of');
      const scope = childOf ? [childOf] : null;
      set('roles', childOf ? ['parent'] : ['admin']);
      set('permissions', childOf ? [] : [...PERMISSIONS]);
      set('activeRole', childOf ? 'parent' : 'admin');
      set('studentScope', scope);
      set('childDb', createChildDb(supabase as never, scope, ctx.orgId, authPool as never));
      set('campusScope', null);
      set('auth', { pool: authPool });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

run('請假不重複（#1957）', () => {
  let app: {
    request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response>;
  };
  const env = {
    ENVIRONMENT: 'contract',
    WEB_URL: 'http://localhost:4200',
    ALLOWED_ORIGINS: '',
  };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const D = '2026-11-02';
  const D2 = '2026-11-11';
  const fx = { klass: '', am: '', pm: '', later: '' };

  const newStudent = async (name: string) => {
    const [s] = await q<{ id: string }>(
      "insert into students (org_id, name, grade) values ($1, $2, 'J1') returning id",
      [ctx.orgId, name],
    );
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
      [ctx.orgId, fx.klass, s!.id],
    );
    return s!.id;
  };
  const addLeave = async (
    studentId: string,
    start: string,
    end: string,
    sessionIds: string[] = [],
  ) => {
    const [l] = await q<{ id: string }>(
      `insert into leave_requests (org_id, student_id, start_date, end_date, submitted_by, submitted_by_role)
       values ($1, $2, $3, $4, $5, 'admin') returning id`,
      [ctx.orgId, studentId, start, end, ctx.userId],
    );
    for (const sid of sessionIds) {
      await q(
        'insert into leave_request_sessions (leave_request_id, session_id, org_id) values ($1, $2, $3)',
        [l!.id, sid, ctx.orgId],
      );
    }
    return l!.id;
  };
  const leavesOf = async (studentId: string) =>
    Number(
      (
        await q<{ n: string }>('select count(*) as n from leave_requests where student_id = $1', [
          studentId,
        ])
      )[0]!.n,
    );

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#1957 契約：請假不重複') returning id",
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
    fx.klass = (
      await q<{ id: string }>(
        "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '班') returning id",
        [ctx.orgId, campus!.id, course!.id],
      )
    )[0]!.id;
    const mk = async (date: string, start: string, end: string) =>
      (
        await q<{ id: string }>(
          `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
           values ($1, $2, $3, $4, $5, 'scheduled', 'unassigned') returning id`,
          [ctx.orgId, fx.klass, date, start, end],
        )
      )[0]!.id;
    fx.am = await mk(D, '09:00', '11:00');
    fx.pm = await mk(D, '14:00', '16:00');
    fx.later = await mk(D2, '09:00', '11:00');
    await q(
      `with e as (
         insert into events (org_id, event_type, title, event_date, start_time, end_time)
         select $1, 'session', s.id::text, s.session_date, s.start_time, s.end_time
           from sessions s where s.org_id = $1
         returning id, title)
       update sessions s set event_id = e.id from e where s.id::text = e.title`,
      [ctx.orgId],
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

  const send = (method: string, path: string, body: unknown, parentOf?: string) =>
    app.request(
      path,
      {
        method,
        headers: {
          'content-type': 'application/json',
          ...(parentOf ? { 'x-contract-parent-of': parentOf } : {}),
        },
        body: JSON.stringify(body),
      },
      env,
    );

  // ── 1. SQL 路徑 ≡ REST 路徑 ≡ 業務規則（#1114 裁定 4）─────────────
  const whole = (startDate: string, endDate: string): LeaveWindow => ({
    startDate,
    endDate,
    startTime: null,
    endTime: null,
    boundSessions: [],
  });
  const bound = (...pairs: Array<[string, string]>): LeaveWindow => {
    const dates = pairs.map(([, d]) => d).sort();
    return {
      startDate: dates[0]!,
      endDate: dates[dates.length - 1]!,
      startTime: null,
      endTime: null,
      boundSessions: pairs.map(([sessionId, date]) => ({ sessionId, date })),
    };
  };
  /** 改寫前 `routes/leaves.ts` 的 `findConflictingLeave`（REST）原樣搬來當對照 */
  const restConflict = async (studentId: string, next: LeaveWindow, excludeId?: string) => {
    const supabase = createServiceClientFromEnv({
      SUPABASE_URL: URL!,
      SUPABASE_SECRET_KEY: KEY!,
    } as never);
    let query = supabase
      .from('leave_requests')
      .select(`id, ${LEAVE_WINDOW_COLUMNS}`)
      .eq('org_id', ctx.orgId)
      .eq('student_id', studentId);
    if (excludeId) query = query.neq('id', excludeId);
    const { data, error } = await query
      .lte('start_date', next.endDate)
      .gte('end_date', next.startDate);
    if (error) throw new Error(error.message);
    const hit = ((data ?? []) as Array<Record<string, unknown>>).find((row) =>
      leavesConflict(toLeaveWindow(row), next),
    );
    return hit ? { start_date: hit['start_date'], end_date: hit['end_date'] } : null;
  };

  it.each([
    ['整天對整天：共用端點日', 'whole-edge', true],
    ['整天對整天：完全沒碰到', 'whole-apart', false],
    ['綁定對綁定：同一天不同堂（合法）', 'bound-other', false],
    ['綁定對綁定：同一堂', 'bound-same', true],
    ['綁定外框重疊、整天假落在兩堂之間的空檔（合法）', 'gap', false],
    ['綁定對整天：整天蓋到綁定那天', 'bound-whole', true],
    ['編輯排除自己', 'self', false],
    ['別的學生的假不算', 'other-student', false],
  ] as const)('SQL ≡ REST：%s', async (_label, kind, expected) => {
    const sid = await newStudent(`比對-${kind}`);
    let next = whole('2026-11-04', '2026-11-06');
    let excludeId: string | undefined;
    if (kind === 'whole-edge') {
      await addLeave(sid, '2026-11-04', '2026-11-06');
      next = whole('2026-11-06', '2026-11-08');
    } else if (kind === 'whole-apart') {
      await addLeave(sid, '2026-11-04', '2026-11-06');
      next = whole('2026-11-07', '2026-11-08');
    } else if (kind === 'bound-other') {
      await addLeave(sid, D, D, [fx.am]);
      next = bound([fx.pm, D]);
    } else if (kind === 'bound-same') {
      await addLeave(sid, D, D, [fx.am]);
      next = bound([fx.am, D]);
    } else if (kind === 'gap') {
      await addLeave(sid, D, D2, [fx.am, fx.later]);
      next = whole('2026-11-05', '2026-11-06');
    } else if (kind === 'bound-whole') {
      await addLeave(sid, D, D, [fx.am]);
      next = whole(D, D);
    } else if (kind === 'self') {
      excludeId = await addLeave(sid, '2026-11-04', '2026-11-06');
      next = whole('2026-11-03', '2026-11-07');
    } else {
      await addLeave(await newStudent('別人'), '2026-11-04', '2026-11-06');
    }
    const viaSql = await findConflictingLeaveViaSql(pool!, ctx.orgId, sid, next, excludeId);
    const viaRest = await restConflict(sid, next, excludeId);
    expect(viaSql).toEqual(viaRest);
    expect(viaSql !== null).toBe(expected);
  });

  // ── 2. 確定性競態：別的交易握著鎖、寫了重疊的假還沒 COMMIT ─────────
  const holdLock = async (studentId: string, start: string, end: string) => {
    const other = await pool!.connect();
    let open = true;
    await other.query('BEGIN');
    await other.query(
      "select pg_advisory_xact_lock(hashtextextended('leave:' || $1::text || ':' || $2::text, 0))",
      [ctx.orgId, studentId],
    );
    await other.query(
      `insert into leave_requests (org_id, student_id, start_date, end_date, submitted_by, submitted_by_role)
       values ($1, $2, $3, $4, $5, 'admin')`,
      [ctx.orgId, studentId, start, end, ctx.userId],
    );
    const finish = async (sql: string) => {
      if (!open) return;
      open = false;
      await other.query(sql);
      other.release();
    };
    return { commit: () => finish('COMMIT'), abort: () => finish('ROLLBACK') };
  };
  /** 等到有人卡在 advisory lock 上；請求先回來了（＝沒排隊）就回 false */
  const waitForLockWaiter = async (isDone: () => boolean) => {
    for (let i = 0; i < 200 && !isDone(); i += 1) {
      const [w] = await q<{ n: string }>(
        "select count(*) as n from pg_locks where locktype = 'advisory' and not granted",
      );
      if (Number(w!.n) > 0) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };

  it('POST：別的交易握著鎖、重疊的假還沒 COMMIT → 等它結束再查，409，DB 只有一張', async () => {
    const sid = await newStudent('競態-POST');
    const held = await holdLock(sid, '2026-11-04', '2026-11-06');
    try {
      let done = false;
      const pending = send('POST', '/api/leaves', {
        studentId: sid,
        startDate: '2026-11-05',
        endDate: '2026-11-07',
      }).finally(() => (done = true));
      expect(await waitForLockWaiter(() => done)).toBe(true);
      await held.commit();
      expect((await pending).status).toBe(409);
    } finally {
      await held.abort();
    }
    expect(await leavesOf(sid)).toBe(1);
  }, 60_000);

  it('PATCH 拉長區間：別的交易握著鎖、新區間裡有它還沒 COMMIT 的假 → 等它、再查，409', async () => {
    const sid = await newStudent('競態-PATCH');
    const mine = await addLeave(sid, '2026-11-02', '2026-11-03');
    const held = await holdLock(sid, '2026-11-08', '2026-11-09');
    try {
      let done = false;
      const pending = send('PATCH', `/api/leaves/${mine}`, {
        endDate: '2026-11-09',
      }).finally(() => (done = true));
      expect(await waitForLockWaiter(() => done)).toBe(true);
      await held.commit();
      expect((await pending).status).toBe(409);
    } finally {
      await held.abort();
    }
    const [row] = await q<{ end_date: string }>(
      'select end_date::text as end_date from leave_requests where id = $1',
      [mine],
    );
    expect(row!.end_date).toBe('2026-11-03');
  }, 60_000);

  it('PATCH 改綁定：別的交易握著鎖、綁了同一堂還沒 COMMIT → 等它、再查，409', async () => {
    const sid = await newStudent('競態-改綁定');
    const mine = await addLeave(sid, D2, D2, [fx.later]);
    const other = await pool!.connect();
    try {
      await other.query('BEGIN');
      await other.query(
        "select pg_advisory_xact_lock(hashtextextended('leave:' || $1::text || ':' || $2::text, 0))",
        [ctx.orgId, sid],
      );
      const [l] = (
        await other.query(
          `insert into leave_requests (org_id, student_id, start_date, end_date, submitted_by, submitted_by_role)
           values ($1, $2, $3, $3, $4, 'admin') returning id`,
          [ctx.orgId, sid, D, ctx.userId],
        )
      ).rows as Array<{ id: string }>;
      await other.query(
        'insert into leave_request_sessions (leave_request_id, session_id, org_id) values ($1, $2, $3)',
        [l!.id, fx.am, ctx.orgId],
      );
      let done = false;
      const pending = send('PATCH', `/api/leaves/${mine}`, {
        sessionIds: [fx.am],
      }).finally(() => (done = true));
      expect(await waitForLockWaiter(() => done)).toBe(true);
      await other.query('COMMIT');
      expect((await pending).status).toBe(409);
    } finally {
      await other.query('ROLLBACK').catch(() => undefined);
      other.release();
    }
  }, 60_000);

  it('鎖只鎖同一個學生：別的學生握著鎖時，這位照常 201、不排隊', async () => {
    const busy = await newStudent('握鎖的人');
    const free = await newStudent('不相干的人');
    const held = await holdLock(busy, '2026-11-04', '2026-11-06');
    try {
      const res = await send('POST', '/api/leaves', {
        studentId: free,
        startDate: '2026-11-04',
        endDate: '2026-11-06',
      });
      expect(res.status).toBe(201);
    } finally {
      await held.abort();
    }
  }, 60_000);

  // ── 3. 真的同時送 ────────────────────────────────────────────
  it('同一個學生同時送兩張重疊的 POST（10 輪）→ 每輪一張 201、一張 409', async () => {
    for (let round = 0; round < 10; round += 1) {
      const sid = await newStudent(`連點-${round}`);
      const body = {
        studentId: sid,
        startDate: '2026-11-04',
        endDate: '2026-11-06',
      };
      const statuses = (
        await Promise.all([send('POST', '/api/leaves', body), send('POST', '/api/leaves', body)])
      )
        .map((r) => r.status)
        .sort();
      expect(statuses).toEqual([201, 409]);
      expect(await leavesOf(sid)).toBe(1);
    }
  }, 120_000);

  it('同一天不同堂的兩張綁定假同時送 → 兩張都 201（合法的不被誤擋）', async () => {
    const sid = await newStudent('上午下午各一張');
    const statuses = (
      await Promise.all([
        send('POST', '/api/leaves', {
          studentId: sid,
          startDate: D,
          endDate: D,
          sessionIds: [fx.am],
        }),
        send('POST', '/api/leaves', {
          studentId: sid,
          startDate: D,
          endDate: D,
          sessionIds: [fx.pm],
        }),
      ])
    ).map((r) => r.status);
    expect(statuses).toEqual([201, 201]);
    expect(await leavesOf(sid)).toBe(2);
  }, 60_000);

  // ── 4. 家長端（#1970）：跟管理端同一把鎖 ─────────────────────────
  const parentPost = (sid: string) =>
    send('POST', '/api/me/leaves', { studentId: sid, startDate: D, endDate: D }, sid);

  it('家長端：別的交易握著鎖、同一天的假還沒 COMMIT → 等它、再查，409', async () => {
    const sid = await newStudent('競態-家長');
    const held = await holdLock(sid, D, D);
    try {
      let done = false;
      const pending = parentPost(sid).finally(() => (done = true));
      expect(await waitForLockWaiter(() => done)).toBe(true);
      await held.commit();
      expect((await pending).status).toBe(409);
    } finally {
      await held.abort();
    }
    expect(await leavesOf(sid)).toBe(1);
  }, 60_000);

  it('家長與行政同時請同一天（10 輪）→ 每輪一張 201、一張 409', async () => {
    for (let round = 0; round < 10; round += 1) {
      const sid = await newStudent(`家長行政-${round}`);
      const statuses = (
        await Promise.all([
          parentPost(sid),
          send('POST', '/api/leaves', { studentId: sid, startDate: D, endDate: D }),
        ])
      )
        .map((r) => r.status)
        .sort();
      expect(statuses).toEqual([201, 409]);
      expect(await leavesOf(sid)).toBe(1);
    }
  }, 120_000);

  it('家長端單筆：送單者記成 parent（不是寫死 admin）', async () => {
    const sid = await newStudent('家長單筆');
    expect((await parentPost(sid)).status).toBe(201);
    const [row] = await q<{ submitted_by_role: string }>(
      'select submitted_by_role from leave_requests where student_id = $1',
      [sid],
    );
    expect(row!.submitted_by_role).toBe('parent');
  }, 60_000);

  it('家長連點：同時兩張 → 一張 201、一張 409', async () => {
    const sid = await newStudent('家長連點');
    const statuses = (await Promise.all([parentPost(sid), parentPost(sid)]))
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual([201, 409]);
    expect(await leavesOf(sid)).toBe(1);
  }, 60_000);
});
