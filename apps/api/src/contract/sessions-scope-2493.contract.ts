// scope-contract: GET /api/sessions
// scope-contract: GET /api/sessions/changes
// scope-contract: GET /api/sessions/:id/makeup-candidates
// scope-contract: PATCH /api/sessions/:id/makeup
// scope-contract: POST /api/sessions
// scope-contract: POST /api/sessions/:id/cancel
// scope-contract: POST /api/sessions/:id/substitute
// scope-contract: POST /api/sessions/:id/reschedule
// scope-contract: PATCH /api/sessions/batch-assign-teacher
// scope-contract: PATCH /api/sessions/batch-cancel
// scope-contract: PATCH /api/sessions/batch-uncancel
// scope-contract: PATCH /api/sessions/batch-update-time
// scope-contract: PATCH /api/sessions/batch-reschedule
// scope-contract: PATCH /api/sessions/batch-substitute
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

/**
 * **#2493 上半：課堂 14 支舊端點的分校範圍契約認領**（保留類：授權範圍），對真的本機 PostgREST＋Postgres 跑。
 * 盤點時範圍已 OK（列表 `applyCampusFilter`、單堂 `resourceCampusAllowed`／`isCampusAllowed`、批次
 * `batchOutOfCampusScope` 類、加開 `classWriteScope`），這裡把它釘住。
 *
 * fixture：C1、C2 各一班；C2 班下週一堂課（帶一筆停課異動，原因「二校異動」）。管理員只被指派 C1。
 * 受限 C1：列表、異動清單讀不到那堂；補課候選、單堂三支、補課連結、六支批次、在 C2 班加開一律 403，
 * 那堂課與課堂數都沒變。不受限同樣的請求過得了範圍那一關（不是 403／404）。
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

const ctx = { orgId: '', userId: '', campusScope: null as string[] | null };

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
      set('campusScope', ctx.campusScope);
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

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

run('#2493 課堂舊端點看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const DAY = shift(getCurrentTaipeiDateString(), 7);
  const fx = { c1: '', c2: '', class2: '', session: '', staff: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：課堂範圍')", []);
    fx.staff = await one(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '代課老師')",
      [ctx.orgId, ctx.userId],
    );
    const subject = await one("insert into subjects (org_id, name) values ($1, '數學')", [
      ctx.orgId,
    ]);
    for (const key of ['1', '2'] as const) {
      const campus = await one('insert into campuses (org_id, name) values ($1, $2)', [
        ctx.orgId,
        `C${key}`,
      ]);
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, `數學 C${key}`, subject],
      );
      const klass = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, course, `班 C${key}`],
      );
      if (key === '1') fx.c1 = campus;
      else Object.assign(fx, { c2: campus, class2: klass });
    }
    fx.session = await one(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
       values ($1, $2, $3, '18:00', '19:00', 'scheduled', 'unassigned')`,
      [ctx.orgId, fx.class2, DAY],
    );
    await q(
      `insert into schedule_changes (org_id, session_id, change_type, reason)
       values ($1, $2, 'cancellation', '二校異動')`,
      [ctx.orgId, fx.session],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from schedule_changes where org_id = $1',
      'delete from sessions where org_id = $1',
      'delete from classes where org_id = $1',
      'delete from courses where org_id = $1',
      'delete from subjects where org_id = $1',
      'delete from staff where org_id = $1',
      'delete from campuses where org_id = $1',
      'delete from audit_logs where org_id = $1',
      'delete from organizations where id = $1',
    ]) {
      await q(sql, [ctx.orgId]);
    }
  }, 120_000);

  const call = async (scope: 'all' | 'c1', method: string, path: string, body?: unknown) => {
    ctx.campusScope = scope === 'all' ? null : [fx.c1];
    try {
      return await app.request(
        `/api/sessions${path}`,
        {
          method,
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        env,
      );
    } finally {
      ctx.campusScope = null;
    }
  };
  const text = async (scope: 'all' | 'c1', path: string) => {
    const res = await call(scope, 'GET', path);
    expect(`${path} → ${res.status}`).toBe(`${path} → 200`);
    return JSON.stringify(await res.json());
  };
  const snapshot = async () =>
    JSON.stringify(
      await q(
        `select s.status, s.session_date, s.start_time, s.end_time, s.teacher_id, s.makeup_for_session_id,
                (select count(*)::int from sessions x where x.org_id = s.org_id) total,
                (select count(*)::int from schedule_changes c where c.org_id = s.org_id) changes
           from sessions s where s.id = $1`,
        [fx.session],
      ),
    );

  it('列表、異動清單：受限 C1 讀不到二校那堂；不受限讀得到', async () => {
    const list = `?dateFrom=${DAY}&dateTo=${DAY}`;
    expect(await text('c1', list)).not.toContain(fx.session);
    expect(await text('all', list)).toContain(fx.session);
    const changes = `/changes?from=${DAY}&to=${DAY}`;
    expect(await text('c1', changes)).not.toContain('二校異動');
    expect(await text('all', changes)).toContain('二校異動');
  });

  it('單堂、補課、批次、加開共 12 支：受限 C1 → 403、那堂沒動；不受限過得了範圍那一關', async () => {
    const ids = [fx.session];
    const calls: Array<[string, string, unknown]> = [
      ['GET', `/${fx.session}/makeup-candidates`, undefined],
      ['PATCH', `/${fx.session}/makeup`, { makeupForSessionId: null }],
      ['POST', '', { classId: fx.class2, sessionDate: DAY, startTime: '20:00', endTime: '21:00' }],
      ['POST', `/${fx.session}/cancel`, { reason: '受限停課' }],
      ['POST', `/${fx.session}/substitute`, { substituteTeacherId: fx.staff }],
      [
        'POST',
        `/${fx.session}/reschedule`,
        { newSessionDate: shift(DAY, 1), newStartTime: '18:00', newEndTime: '19:00' },
      ],
      ['PATCH', '/batch-assign-teacher', { sessionIds: ids, teacherId: fx.staff }],
      ['PATCH', '/batch-update-time', { sessionIds: ids, startTime: '17:00', endTime: '18:00' }],
      ['PATCH', '/batch-reschedule', { sessionIds: ids, dayOffset: 1 }],
      ['PATCH', '/batch-substitute', { sessionIds: ids, substituteTeacherId: fx.staff }],
      ['PATCH', '/batch-cancel', { sessionIds: ids }],
      ['PATCH', '/batch-uncancel', { sessionIds: ids }],
    ];
    const before = await snapshot();
    for (const [method, path, body] of calls) {
      expect(`${method} ${path} → ${(await call('c1', method, path, body)).status}`).toBe(
        `${method} ${path} → 403`,
      );
    }
    expect(await snapshot()).toBe(before);
    for (const [method, path, body] of calls) {
      expect(`${method} ${path} → ${(await call('all', method, path, body)).status}`).not.toMatch(
        /→ 40[34]$/,
      );
    }
  });
});
