import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2230 ①：停用課程取消未來堂、班級批次啟用／停用改在 DB 端一次做完**（保留類：分校範圍），對真的本機 DB 跑。
 *
 * 1. 停用課程：原本先撈要取消的課堂 id（沒分頁 → max_rows 1000 截斷），再 `.in('id', …)` 更新（414），
 *    流水寫失敗時手動 rollback、rollback 的錯誤被吞。fixture：一班未來 HUGE 堂。
 * 2. batch-set-active：原本三支 `.in('id', ids)`，更新失敗回 `{ updated: 0 }` 200。
 *
 * 「DB 端失敗」用只對本測試 org 生效的 trigger 造（同 #2237 契約），舊碼新碼吃到同一個錯。
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

type Who = 'admin' | 'c1';
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
      set('supabase', supabase);
      set('orgId', ctx.orgId);
      set('userId', ctx.userId);
      set('roles', ['admin']);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', 'admin');
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

const HUGE = 1100;
const MANY = 200;

run('#2230 ① 停用課程取消未來堂／班級批次啟用停用', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = {
    subject: '',
    c2: '',
    course: '',
    brokenCourse: '',
    other: '',
    bigClass: '',
    otherClass: '',
    brokenClass: '',
    c2Class: '',
    many: [] as string[],
    teacherUser: '',
  };

  const course = (campus: string, name: string) =>
    one('insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)', [
      ctx.orgId,
      campus,
      name,
      fx.subject,
    ]);
  const cls = (campus: string, courseId: string, name: string) =>
    one('insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)', [
      ctx.orgId,
      campus,
      courseId,
      name,
    ]);
  const futureSessions = (classId: string, n: number) =>
    q(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
       select $1, $2, date '2031-01-01' + g, '18:00', '19:00', 'scheduled', 'unassigned'
         from generate_series(0, ${n - 1}) g`,
      [ctx.orgId, classId],
    );

  beforeAll(async () => {
    ctx.userId = (
      await q<{ user_id: string }>(
        "select user_id from user_roles where role = 'admin' order by user_id limit 1",
      )
    )[0]!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2230 契約：批次寫入')", []);
    fx.subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    ctx.c1 = await one("insert into campuses (org_id, name) values ($1, 'c1')", [ctx.orgId]);
    fx.c2 = await one("insert into campuses (org_id, name) values ($1, 'c2')", [ctx.orgId]);

    fx.course = await course(ctx.c1, '要停用的課');
    fx.bigClass = await cls(ctx.c1, fx.course, '大班');
    await futureSessions(fx.bigClass, HUGE);
    // 不動的：已完成的未來堂、過去的堂、別門課的未來堂
    await q(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
       values ($1, $2, '2035-06-01', '18:00', '19:00', 'completed', 'unassigned'),
              ($1, $2, '2020-01-01', '18:00', '19:00', 'scheduled', 'unassigned')`,
      [ctx.orgId, fx.bigClass],
    );
    // 大班的任課老師：停用後要收到課務異動通知（通知在背景查課堂，1100 堂一條 URL 會 414、只記 log）
    fx.teacherUser = (
      await q<{ user_id: string }>(
        "select user_id from user_roles where role = 'teacher' and user_id <> $1 order by user_id limit 1",
        [ctx.userId],
      )
    )[0]!.user_id;
    const teacherStaff = await one(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '大班老師')",
      [ctx.orgId, fx.teacherUser],
    );
    await q(
      `insert into schedules (class_id, weekday, start_time, end_time, teacher_id, effective_from, effective_to)
       values ($1, 1, '18:00', '19:00', $2, '2030-01-01', null)`,
      [fx.bigClass, teacherStaff],
    );
    fx.other = await course(ctx.c1, '別門課');
    fx.otherClass = await cls(ctx.c1, fx.other, '別班');
    await futureSessions(fx.otherClass, 3);
    fx.brokenCourse = await course(ctx.c1, '流水會失敗的課');
    fx.brokenClass = await cls(ctx.c1, fx.brokenCourse, '壞班');
    await futureSessions(fx.brokenClass, 5);

    fx.many = (
      await q<{ id: string }>(
        `insert into classes (org_id, campus_id, course_id, name)
         select $1, $2, $3, '批次 ' || g from generate_series(1, ${MANY}) g returning id`,
        [ctx.orgId, ctx.c1, fx.other],
      )
    ).map((r) => r.id);
    fx.c2Class = await cls(fx.c2, await course(fx.c2, '二校課'), '二校班');

    // 只對本 org 生效的失敗：流水寫入「流水會失敗的課」那幾堂時、更新「壞班」時
    // trigger 的 WHEN 不能放子查詢，判斷寫在函式裡
    await q(`create or replace function contract_2230_fail() returns trigger language plpgsql as $$
      begin
        -- plpgsql 的 or 不保證短路：classes 列沒有 session_id，分開判
        if tg_table_name = 'classes' then
          if old.id = '${fx.brokenClass}' then raise exception 'contract 2230 boom'; end if;
        elsif exists (
          select 1 from sessions s where s.id = new.session_id and s.class_id = '${fx.brokenClass}') then
          raise exception 'contract 2230 boom';
        end if;
        return coalesce(new, old);
      end $$`);
    await q(`create trigger contract_2230_sc before insert on schedule_changes for each row
      when (new.org_id = '${ctx.orgId}') execute function contract_2230_fail()`);
    await q(`create trigger contract_2230_cls before update on classes for each row
      when (old.org_id = '${ctx.orgId}') execute function contract_2230_fail()`);
    app = (await import('../index')).default as never;
  }, 180_000);

  afterAll(async () => {
    await q('drop trigger if exists contract_2230_sc on schedule_changes');
    await q('drop trigger if exists contract_2230_cls on classes');
    await q('drop function if exists contract_2230_fail()');
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from schedule_changes where org_id = $1',
      'delete from sessions where org_id = $1',
      'delete from schedules where class_id in (select id from classes where org_id = $1)',
      'delete from classes where org_id = $1',
      'delete from courses where org_id = $1',
      'delete from subjects where org_id = $1',
      'delete from staff where org_id = $1',
      'delete from campuses where org_id = $1',
      'delete from audit_logs where org_id = $1',
      'delete from notifications where org_id = $1',
      'delete from organizations where id = $1',
    ]) {
      await q(sql, [ctx.orgId]);
    }
  }, 120_000);

  const send = async (who: Who, method: string, path: string, body: unknown) => {
    ctx.who = who;
    try {
      return await app.request(
        path,
        { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
        env,
      );
    } finally {
      ctx.who = 'admin';
    }
  };
  const statusCount = async (classId: string) =>
    Object.fromEntries(
      (
        await q<{ status: string; n: string }>(
          'select status, count(*) n from sessions where class_id = $1 group by status',
          [classId],
        )
      ).map((r) => [r.status, Number(r.n)]),
    );
  const deactivate = { isActive: false, deactivateMode: 'cancel_future_sessions' };

  it(`停用課程：${HUGE} 堂未來課全取消、每堂一筆流水同一批；已完成、過去、別門課不動`, async () => {
    const res = await send('admin', 'PUT', `/api/courses/${fx.course}`, deactivate);
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { cancelledFutureSessions: number }).cancelledFutureSessions,
    ).toBe(HUGE);
    expect(await statusCount(fx.bigClass)).toEqual({
      cancelled: HUGE,
      completed: 1,
      scheduled: 1,
    });
    expect(await statusCount(fx.otherClass)).toEqual({ scheduled: 3 });
    const [log] = await q<{ n: string; batches: string; sources: string[] }>(
      `select count(*) n, count(distinct batch_id) batches, array_agg(distinct operation_source) sources
         from schedule_changes
        where org_id = $1 and change_type = 'cancellation' and reason = '課程停用'`,
      [ctx.orgId],
    );
    expect({ n: Number(log!.n), batches: Number(log!.batches), sources: log!.sources }).toEqual({
      n: HUGE,
      batches: 1,
      sources: ['batch'],
    });
    // 通知（測試沒有 waitUntil，路由會等它跑完）：任課老師收到一則課務異動
    const [notice] = await q<{ n: string }>(
      `select count(*) n from notifications
        where org_id = $1 and user_id = $2 and kind = 'schedule_change'`,
      [ctx.orgId, fx.teacherUser],
    );
    expect(Number(notice!.n)).toBe(1);
  });

  it('停用課程：流水寫失敗 → 500，課堂一堂都沒取消（同一筆交易，不靠手動 rollback）', async () => {
    const res = await send('admin', 'PUT', `/api/courses/${fx.brokenCourse}`, deactivate);
    expect(res.status).toBe(500);
    expect(await statusCount(fx.brokenClass)).toEqual({ scheduled: 5 });
  });

  it(`batch-set-active：${MANY} 班一次停用全數生效`, async () => {
    const res = await send('admin', 'PATCH', '/api/classes/batch-set-active', {
      ids: fx.many,
      isActive: false,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: MANY });
    const [row] = await q<{ n: string }>(
      'select count(*) n from classes where id = any($1::uuid[]) and is_active = false',
      [fx.many],
    );
    expect(Number(row!.n)).toBe(MANY);
  });

  it('batch-set-active：超過 200 個 id → 400', async () => {
    const res = await send('admin', 'PATCH', '/api/classes/batch-set-active', {
      ids: [...fx.many, fx.bigClass],
      isActive: true,
    });
    expect(res.status).toBe(400);
  });

  it('batch-set-active 受限 C1：混一個二校班 → 403，整批都沒動', async () => {
    const res = await send('c1', 'PATCH', '/api/classes/batch-set-active', {
      ids: [fx.otherClass, fx.c2Class],
      isActive: false,
    });
    expect(res.status).toBe(403);
    const rows = await q<{ is_active: boolean }>(
      'select is_active from classes where id = any($1::uuid[])',
      [[fx.otherClass, fx.c2Class]],
    );
    expect(rows.every((r) => r.is_active)).toBe(true);
    // 只送自己分校的 → 200（防過度擋）
    const own = await send('c1', 'PATCH', '/api/classes/batch-set-active', {
      ids: [fx.otherClass],
      isActive: true,
    });
    expect(own.status).toBe(200);
  });

  it('batch-set-active：混一個別 org／不存在的 id → 404，整批都沒動', async () => {
    const res = await send('admin', 'PATCH', '/api/classes/batch-set-active', {
      ids: [fx.otherClass, '00000000-0000-4000-8000-000000002230'],
      isActive: false,
    });
    expect(res.status).toBe(404);
    expect(
      (
        await q<{ is_active: boolean }>('select is_active from classes where id = $1', [
          fx.otherClass,
        ])
      )[0]!.is_active,
    ).toBe(true);
  });

  it('batch-set-active：更新失敗 → 500，不是 { updated: 0 } 200；同批其他班也沒動', async () => {
    const res = await send('admin', 'PATCH', '/api/classes/batch-set-active', {
      ids: [fx.otherClass, fx.brokenClass],
      isActive: false,
    });
    expect(res.status).toBe(500);
    expect(
      (
        await q<{ is_active: boolean }>('select is_active from classes where id = $1', [
          fx.otherClass,
        ])
      )[0]!.is_active,
    ).toBe(true);
  });
});
