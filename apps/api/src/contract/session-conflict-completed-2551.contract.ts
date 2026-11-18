import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2551 衝突檢查：已點名（completed）的堂照樣佔時段**：改期撞同班、代課撞同老師，已點名的堂與 scheduled 一樣報衝突；已停課的不佔。
 * 對真的本機 PostgREST＋Postgres 跑；已點名用直接把 status 設成 completed 當 fixture（不依賴 #2546）。
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

const ctx = { orgId: '', userId: '', roles: ['admin'] as string[] };

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
      set('roles', ctx.roles);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', ctx.roles[0]);
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', null);
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

run('#2551 completed 的堂照樣佔時段', () => {
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
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { campus: '', klass: '', other: '', teacherA: '', teacherB: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2551 契約：衝突檢查')", []);
    fx.campus = await one("insert into campuses (org_id, name) values ($1, 'A 校')", [ctx.orgId]);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    const course = await one(
      'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
      [ctx.orgId, fx.campus, '數學', subject],
    );
    const klass = (name: string) =>
      one('insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)', [
        ctx.orgId,
        fx.campus,
        course,
        name,
      ]);
    fx.klass = await klass('甲班');
    fx.other = await klass('乙班');
    const staff = (userId: string, name: string) =>
      one('insert into staff (org_id, user_id, display_name) values ($1, $2, $3)', [
        ctx.orgId,
        userId,
        name,
      ]);
    fx.teacherA = await staff('40000000-0000-0000-0000-000000000001', '原老師');
    fx.teacherB = await staff('40000000-0000-0000-0000-000000000002', '代課老師');
    await q('insert into staff_subjects (staff_id, subject_id) values ($1, $2)', [
      fx.teacherB,
      subject,
    ]);
    await q('insert into staff_campuses (staff_id, campus_id) values ($1, $2)', [
      fx.teacherB,
      fx.campus,
    ]);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from schedule_changes where org_id = $1',
      'delete from sessions where org_id = $1',
      'delete from staff where org_id = $1',
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

  const mk = (
    klass: string,
    date: string,
    start: string,
    end: string,
    status: string,
    teacher: string | null = null,
  ) =>
    one(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status, teacher_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [ctx.orgId, klass, date, start, end, status, teacher ? 'assigned' : 'unassigned', teacher],
    );
  const post = (path: string, body: unknown) =>
    app.request(
      path,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      env,
    );
  const code = async (res: Response) => ((await res.clone().json()) as { code?: string }).code;

  // 佔位的堂 X（狀態是變數）與被搬的堂 Y 同班；Y 搬進 X 的時段
  const reschedule = async (xStatus: string, date: string) => {
    await mk(fx.klass, date, '10:00', '11:00', xStatus);
    const y = await mk(fx.klass, '2026-04-01', '10:00', '11:00', 'scheduled');
    const res = await post(`/api/sessions/${y}/reschedule`, {
      newSessionDate: date,
      newStartTime: '10:30',
      newEndTime: '11:30',
    });
    // 每次都把 Y 清掉，下一輪才有乾淨的 04-01
    await q('delete from schedule_changes where session_id = $1', [y]);
    await q('delete from sessions where id = $1', [y]);
    return res;
  };

  it('改期撞同班：scheduled 與 completed 的堂都報 CLASS_CONFLICT；cancelled 的不佔', async () => {
    for (const [status, date] of [
      ['scheduled', '2026-03-01'],
      ['completed', '2026-03-02'],
    ] as const) {
      const res = await reschedule(status, date);
      expect({ status, http: res.status, code: await code(res) }).toEqual({
        status,
        http: 409,
        code: 'CLASS_CONFLICT',
      });
    }
    expect((await reschedule('cancelled', '2026-03-03')).status).toBe(200);
  });

  // 代課老師 B 在同一時段已有別班的堂 Z（狀態是變數）；原堂 S 由 A 任課，要換成 B
  const substitute = async (zStatus: string, day: string) => {
    await mk(fx.other, day, '14:00', '15:00', zStatus, fx.teacherB);
    const s = await mk(fx.klass, day, '14:00', '15:00', 'scheduled', fx.teacherA);
    return post(`/api/sessions/${s}/substitute`, {
      substituteTeacherId: fx.teacherB,
    });
  };

  it('代課撞同老師：scheduled 與 completed 的堂都報 TEACHER_CONFLICT；cancelled 的不佔', async () => {
    for (const [status, day] of [
      ['scheduled', '2026-05-01'],
      ['completed', '2026-05-02'],
    ] as const) {
      const res = await substitute(status, day);
      expect({ status, http: res.status, code: await code(res) }).toEqual({
        status,
        http: 409,
        code: 'TEACHER_CONFLICT',
      });
    }
    expect((await substitute('cancelled', '2026-05-03')).status).toBe(200);
  });
});
