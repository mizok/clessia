import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * #2232（#1928 C 段）：課堂批次與「停掉班級未來的課」一次超過 ~200 堂就 414，對真的本機 PostgREST 跑。
 *
 * 原本六支 `PATCH /sessions/batch-*` 把勾到的 id 整串放進 `.in('id', …)`（查詢與更新都在 URL 上），
 * `cancel-future-sessions` 先撈出這個班未來的課堂 id 再 `.update().in('id', …)`。替身不在乎 URL 長度，量不到。
 *
 * 一個班 250 堂（每週一堂、錯開日期不撞堂），每支各打一次 250 堂，並看 DB 真的改了 250 堂。
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
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      // 寫入走池（#2232）：同 #2237 的契約
      set('auth', {
        pool: {
          query: pool!.query.bind(pool),
          connect: pool!.connect.bind(pool),
          end: async () => undefined,
        },
      });
      await next();
    }),
  };
});

const N = 250;

run('課堂批次與停掉未來的課超過 200 堂（#2232）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const fx = { klass: '', t1: '', t2: '', ids: [] as string[] };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#2232 契約：課堂批次 250 堂') returning id",
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
    // 兩位老師：借 seed 裡有 teacher 角色的帳號，在這個 org 開 staff，教這科、在這間分校
    const users = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'teacher' order by user_id limit 2",
    );
    const staff = async (userId: string, name: string) => {
      const [s] = await q<{ id: string }>(
        'insert into staff (org_id, user_id, display_name) values ($1, $2, $3) returning id',
        [ctx.orgId, userId, name],
      );
      await q('insert into staff_subjects (staff_id, subject_id) values ($1, $2)', [
        s!.id,
        subject!.id,
      ]);
      await q('insert into staff_campuses (staff_id, campus_id) values ($1, $2)', [
        s!.id,
        campus!.id,
      ]);
      return s!.id;
    };
    fx.t1 = await staff(users[0]!.user_id, '甲老師');
    fx.t2 = await staff(users[1]!.user_id, '乙老師');
    // 2030 起每週一堂（週一），彼此不撞堂；改到隔天、改時間都還是不撞
    fx.ids = (
      await q<{ id: string }>(
        `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status, teacher_id)
         select $1, $2, date '2030-01-07' + (i * 7), '18:00', '19:00', 'scheduled', 'assigned', $3
           from generate_series(0, ${N - 1}) i
         returning id`,
        [ctx.orgId, fx.klass, fx.t1],
      )
    ).map((r) => r.id);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    await q('drop trigger if exists contract_2232_fail on public.schedule_changes');
    await q('drop function if exists public.contract_2232_fail()');
    for (const sql of [
      'delete from schedule_changes where org_id = $1',
      'delete from sessions where org_id = $1',
      'delete from staff_subjects where staff_id in (select id from staff where org_id = $1)',
      'delete from staff_campuses where staff_id in (select id from staff where org_id = $1)',
      'delete from staff where org_id = $1',
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

  /** 每條自己建起點：全部回到「甲老師、18:00–19:00、原日期、正常」 */
  const reset = () =>
    q(
      `update sessions set teacher_id = $2, assignment_status = 'assigned', status = 'scheduled',
              start_time = '18:00', end_time = '19:00',
              -- 只有「改到別天」會動日期（往後一天），拉回那週的週一
              session_date = session_date - (extract(isodow from session_date)::int - 1)
        where org_id = $1`,
      [ctx.orgId, fx.t1],
    );
  const count = async (where: string, values: unknown[] = []) =>
    Number(
      (
        await q<{ n: string }>(`select count(*) n from sessions where org_id = $1 and ${where}`, [
          ctx.orgId,
          ...values,
        ])
      )[0]!.n,
    );
  const patch = (path: string, body: Record<string, unknown>) =>
    app.request(
      `/api/sessions/${path}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionIds: fx.ids, dryRun: false, ...body }),
      },
      env,
    );
  const ok = async (res: Response) => {
    if (res.status !== 200) throw new Error(`${res.status} ${await res.text()}`);
  };

  it('批次指派老師：250 堂都換成乙老師', async () => {
    await reset();
    await ok(await patch('batch-assign-teacher', { teacherId: fx.t2, includeAssigned: true }));
    expect(await count('teacher_id = $2', [fx.t2])).toBe(N);
  });

  it('批次代課：250 堂都由乙老師代', async () => {
    await reset();
    await ok(await patch('batch-substitute', { substituteTeacherId: fx.t2, reason: '請假' }));
    expect(await count('teacher_id = $2', [fx.t2])).toBe(N);
  });

  it('批次改時間：250 堂都改成 19:00–20:00', async () => {
    await reset();
    await ok(await patch('batch-update-time', { startTime: '19:00', endTime: '20:00' }));
    expect(await count("start_time = '19:00'")).toBe(N);
  });

  it('批次改到別天：250 堂都往後一天', async () => {
    await reset();
    await ok(await patch('batch-reschedule', { dayOffset: 1 }));
    expect(await count('extract(isodow from session_date) = 2')).toBe(N);
  });

  it('批次停課、再批次恢復：250 堂', async () => {
    await reset();
    await ok(await patch('batch-cancel', { reason: '颱風' }));
    expect(await count("status = 'cancelled'")).toBe(N);
    await ok(await patch('batch-uncancel', {}));
    expect(await count("status = 'scheduled'")).toBe(N);
  });

  it('停課的流水寫入失敗 → 500，250 堂整批回滾（還是正常、沒有流水）；拿掉故障再送就成', async () => {
    await reset();
    await q('delete from schedule_changes where org_id = $1', [ctx.orgId]);
    await q(`create or replace function public.contract_2232_fail() returns trigger language plpgsql as $$
             begin raise exception 'contract 2232: schedule_changes blocked'; end $$`);
    await q(`create trigger contract_2232_fail before insert on public.schedule_changes
             for each row when (new.org_id = '${ctx.orgId}'::uuid) execute function public.contract_2232_fail()`);
    try {
      expect((await patch('batch-cancel', { reason: '颱風' })).status).toBe(500);
    } finally {
      await q('drop trigger if exists contract_2232_fail on public.schedule_changes');
      await q('drop function if exists public.contract_2232_fail()');
    }
    expect(await count("status = 'scheduled'")).toBe(N);
    expect(
      Number(
        (
          await q<{ n: string }>('select count(*) n from schedule_changes where org_id = $1', [
            ctx.orgId,
          ])
        )[0]!.n,
      ),
    ).toBe(0);

    await ok(await patch('batch-cancel', { reason: '颱風' }));
    expect(await count("status = 'cancelled'")).toBe(N);
    expect(
      Number(
        (
          await q<{ n: string }>('select count(*) n from schedule_changes where org_id = $1', [
            ctx.orgId,
          ])
        )[0]!.n,
      ),
    ).toBe(N);
  });

  it('停掉班級未來的課：250 堂都停，不經過 id 清單', async () => {
    await reset();
    const res = await app.request(
      `/api/classes/${fx.klass}/cancel-future-sessions`,
      { method: 'POST' },
      env,
    );
    await ok(res);
    expect(((await res.json()) as { cancelled: number }).cancelled).toBe(N);
    expect(await count("status = 'cancelled'")).toBe(N);
  });

  it('班級底下的批次（web 沒有呼叫端）上限 100：101 堂回 400', async () => {
    const res = await app.request(
      `/api/classes/${fx.klass}/sessions/batch-cancel`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionIds: fx.ids.slice(0, 101), dryRun: true }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});
