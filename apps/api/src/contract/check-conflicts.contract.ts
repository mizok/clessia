import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **排課衝突預檢（POST /api/classes/check-conflicts）在班很多的 org 也查得到撞課**（#1928）。
 *
 * 原本先撈整個 org 歷年所有班級 id、塞回 `.in('class_id', …)`：班一多網址太長 → 414，
 * 而錯誤是 soft-fail 回 200「沒有衝突」；那份清單本身也被 max_rows（1000）截斷。
 * 改成 org 範圍在時段查詢的 join 裡套（`classes!inner` ＋ `classes.org_id`）。
 *
 * 這支自建一個有 1200 個班的 org，撞課的時段放在第 1150 班（超過 1000 列、也超過 .in 撐得住的長度），
 * 另建一個 org 放一模一樣的時段。斷言：200、只回本 org 那一筆衝突；排除那個班就沒有衝突。測完全部刪掉。
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
      await next();
    }),
  };
});

const CLASSES = 1200;
const TARGET = 1150;

run('排課衝突預檢：1200 個班的 org（#1928）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const orgs: string[] = [];
  let teacherId = '';
  let targetClassId = '';

  /** 建一個 org：分校、課、N 個班、一位老師；第 target 班排一個週二 14:30–15:30 的時段 */
  async function seedOrg(name: string, classes: number, target: number) {
    const [org] = await q<{ id: string }>(
      'insert into organizations (name) values ($1) returning id',
      [name],
    );
    orgs.push(org!.id);
    const [campus] = await q<{ id: string }>(
      "insert into campuses (org_id, name) values ($1, '分校') returning id",
      [org!.id],
    );
    const [subject] = await q<{ id: string }>(
      "insert into subjects (org_id, name) values ($1, '數學') returning id",
      [org!.id],
    );
    const [course] = await q<{ id: string }>(
      "insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, '數學', $3) returning id",
      [org!.id, campus!.id, subject!.id],
    );
    await q(
      `insert into classes (org_id, campus_id, course_id, name)
       select $1, $2, $3, '班' || g from generate_series(1, $4::int) g`,
      [org!.id, campus!.id, course!.id, classes],
    );
    const [staff] = await q<{ id: string }>(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '王老師') returning id",
      [org!.id, ctx.userId],
    );
    const [cls] = await q<{ id: string }>(
      'select id from classes where org_id = $1 and name = $2',
      [org!.id, `班${target}`],
    );
    await q(
      `insert into schedules (class_id, teacher_id, weekday, start_time, end_time)
       values ($1, $2, 2, '14:30', '15:30')`,
      [cls!.id, staff!.id],
    );
    return { orgId: org!.id, staffId: staff!.id, classId: cls!.id };
  }

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    const mine = await seedOrg('#1928 契約：撞課預檢', CLASSES, TARGET);
    ctx.orgId = mine.orgId;
    teacherId = mine.staffId;
    targetClassId = mine.classId;
    // 別家 org：一模一樣的時段（不同的 staff），不能漏進來
    await seedOrg('#1928 契約：撞課預檢（別家）', 3, 2);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    for (const orgId of orgs) {
      await q(
        'delete from schedules where class_id in (select id from classes where org_id = $1)',
        [orgId],
      );
      await q('delete from classes where org_id = $1', [orgId]);
      await q('delete from courses where org_id = $1', [orgId]);
      await q('delete from subjects where org_id = $1', [orgId]);
      await q('delete from staff where org_id = $1', [orgId]);
      await q('delete from campuses where org_id = $1', [orgId]);
      await q('delete from organizations where id = $1', [orgId]);
    }
  }, 120_000);

  const check = async (body: unknown) => {
    const res = await app.request(
      '/api/classes/check-conflicts',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      env,
    );
    return {
      status: res.status,
      body: (await res.json()) as { conflicts: { conflictingClassId: string }[] },
    };
  };

  it('第 1150 班的撞課查得到（200，只有本 org 那一筆）', async () => {
    const res = await check({
      schedules: [{ weekday: 2, startTime: '14:00', endTime: '15:00', teacherId }],
    });
    expect(res.status).toBe(200);
    expect(res.body.conflicts.map((c) => c.conflictingClassId)).toEqual([targetClassId]);
  });

  it('排除那個班（編輯它自己）：沒有衝突', async () => {
    const res = await check({
      schedules: [{ weekday: 2, startTime: '14:00', endTime: '15:00', teacherId }],
      excludeClassId: targetClassId,
    });
    expect(res).toEqual({ status: 200, body: { conflicts: [] } });
  });
});
